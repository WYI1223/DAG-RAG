#!/usr/bin/env node
/**
 * cli/index.ts
 *
 * Commands:
 *   adr-graph init    — cold-start: scan project, build initial DAG
 *   adr-graph scan    — re-scan after code changes, update DAG
 *   adr-graph status  — show current DAG stats and any drift warnings
 *   adr-graph viz     — generate HTML visualization (coming soon)
 */

import "dotenv/config";
import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import * as path from "path";
import * as fs from "fs";

import { scanProject } from "../core/ast/scanner.js";
import { scanAdrDirectory } from "../core/dag/adr-parser.js";
import { buildDAG, computeStats } from "../core/dag/builder.js";
import { loadDAG, saveDAG, ensureGitignoreEntry } from "../core/dag/store.js";
import { analyzeImpact } from "../core/dag/impact.js";
import { generateHTML } from "../core/viz/html-generator.js";
import { createSemanticClient, analyzeSemantics } from "../core/semantic/index.js";

/** Create a write stream for verbose output; returns the log path and stream */
function createVerboseLog(projectRoot: string): { logPath: string; stream: fs.WriteStream } {
  const dagDir = path.join(projectRoot, ".adr-graph");
  if (!fs.existsSync(dagDir)) fs.mkdirSync(dagDir, { recursive: true });
  const logPath = path.join(dagDir, "verbose.log");
  const stream = fs.createWriteStream(logPath, { flags: "w" });
  return { logPath, stream };
}

/** Try to open a file in VSCode editor */
async function openInEditor(filePath: string) {
  const { execSync } = await import("child_process");
  try {
    execSync(`code "${filePath}"`, { stdio: "ignore" });
  } catch { /* not in VSCode or code CLI not available */ }
}

const program = new Command();

program
  .name("adr-graph")
  .description("Semantic Git — binds architecture decisions to code")
  .version("0.1.0");

// ---- init --------------------------------------------------

program
  .command("init")
  .description("Cold-start: scan project and build initial semantic DAG")
  .option("-r, --root <path>", "project root", process.cwd())
  .option("--adr-dir <path>", "ADR directory", "docs/adrs")
  .option("--no-semantic", "skip LLM semantic analysis")
  .option("--verbose", "show raw LLM prompts and responses")
  .action(async (opts) => {
    const projectRoot = path.resolve(opts.root);
    const adrDir = path.resolve(projectRoot, opts.adrDir);

    console.log(chalk.bold("\n🔍 adr-graph init\n"));
    console.log(chalk.dim(`Project root: ${projectRoot}`));
    console.log(chalk.dim(`ADR directory: ${adrDir}\n`));

    // Phase 1: AST scan
    const astSpinner = ora("Scanning TypeScript modules (AST)...").start();
    let scanResult;
    try {
      scanResult = await scanProject({ projectRoot });
      astSpinner.succeed(
        chalk.green(`Found ${scanResult.modules.length} modules, ${scanResult.edges.length} dependency edges`)
      );
    } catch (e) {
      astSpinner.fail("AST scan failed");
      console.error(e);
      process.exit(1);
    }

    // Phase 2: ADR scan
    const adrSpinner = ora("Parsing ADR files...").start();
    const adrs = scanAdrDirectory(adrDir);
    if (adrs.length === 0) {
      adrSpinner.warn(
        chalk.yellow(`No ADR files found in ${opts.adrDir} — continuing without ADR nodes`)
      );
    } else {
      adrSpinner.succeed(chalk.green(`Found ${adrs.length} ADR files`));
    }

    // Build DAG
    const buildSpinner = ora("Building semantic DAG...").start();
    const dag = buildDAG(projectRoot, scanResult, adrs);
    buildSpinner.succeed(chalk.green("Structural DAG built"));

    // Phase 3: Semantic analysis (LLM)
    if (opts.semantic !== false && adrs.length > 0) {
      const client = createSemanticClient();
      if (client) {
        const providerLabel = { anthropic: "Anthropic API", bedrock: "AWS Bedrock", vertex: "Google Vertex AI", compatible: "Compatible API" }[client.provider];
        const semSpinner = ora(`Analyzing semantic relationships (${providerLabel})...`).start();
        let verboseLog: { logPath: string; stream: fs.WriteStream } | null = null;
        if (opts.verbose) { verboseLog = createVerboseLog(projectRoot); }
        try {
          const semResult = await analyzeSemantics(dag, adrs, client, {
            onProgress: (p) => {
              const icon = p.status === "error" ? "✗" : p.status === "done" ? "✓" : "…";
              const tps = p.tokensPerSec ? `  ${p.tokensPerSec} tok/s` : "";
              semSpinner.text = `[${p.current}/${p.total}] ${icon} ${p.adrId}  (+${p.edgesAdded} edges)${tps}`;
            },
            verbose: opts.verbose,
            verboseStream: verboseLog?.stream,
          });
          if (verboseLog) { verboseLog.stream.end(); await openInEditor(verboseLog.logPath); }
          const avgTps = semResult.totalDurationMs > 0
            ? Math.round((semResult.totalOutputTokens / semResult.totalDurationMs) * 1000)
            : 0;
          const tokenInfo = semResult.totalOutputTokens > 0
            ? `  (${semResult.totalInputTokens} in / ${semResult.totalOutputTokens} out, ${avgTps} tok/s)`
            : "";
          semSpinner.succeed(
            chalk.green(`Inferred ${semResult.edgesAdded} semantic edges from ${semResult.adrCount} ADRs`) + chalk.dim(tokenInfo)
          );
          if (verboseLog) console.log(chalk.dim(`  Verbose log: ${verboseLog.logPath}`));
          if (semResult.errors.length > 0) {
            for (const err of semResult.errors) {
              console.log(chalk.yellow(`  ⚠ ${err}`));
            }
          }
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          semSpinner.fail(`Semantic analysis failed: ${msg}`);
        }
      } else {
        console.log(chalk.dim("  Semantic layer skipped — set ADR_GRAPH_ANTHROPIC_KEY for LLM analysis"));
      }
    }

    saveDAG(dag, projectRoot);
    ensureGitignoreEntry(projectRoot);

    // Summary
    const stats = computeStats(dag);
    console.log(chalk.bold("\n📊 Initial DAG summary:\n"));
    console.log(`  Nodes:  ${stats.totalNodes}  (${stats.adrCount} ADRs, ${stats.moduleCount} modules)`);
    console.log(`  Edges:  ${stats.totalEdges}  (${stats.certainEdges} certain, ${stats.inferredEdges} inferred)`);
    console.log(`  Bindings (ADR↔Module): ${stats.implementsEdges}`);
    console.log(`  Dependencies (Module→Module): ${stats.dependsOnEdges}`);

    if (adrs.length === 0) {
      console.log(chalk.yellow("\n💡 No ADRs found. Create your first one:"));
      console.log(chalk.dim(`   mkdir -p ${opts.adrDir} && touch ${opts.adrDir}/ADR-001-initial-architecture.md`));
      console.log(chalk.dim("   Then run: adr-graph scan\n"));
    } else {
      console.log(chalk.green("\n✅ Ready. Run `adr-graph status` to check for drift.\n"));
    }
  });

// ---- scan --------------------------------------------------

program
  .command("scan")
  .description("Re-scan project and update DAG (run after code changes)")
  .option("-r, --root <path>", "project root", process.cwd())
  .option("--adr-dir <path>", "ADR directory", "docs/adrs")
  .option("--no-semantic", "skip LLM semantic analysis")
  .option("--verbose", "show raw LLM prompts and responses")
  .action(async (opts) => {
    const projectRoot = path.resolve(opts.root);
    const adrDir = path.resolve(projectRoot, opts.adrDir);

    const existing = loadDAG(projectRoot);
    if (!existing) {
      console.log(chalk.yellow("No DAG found. Run `adr-graph init` first."));
      process.exit(1);
    }

    console.log(chalk.bold("\n🔄 adr-graph scan\n"));

    const spinner = ora("Re-scanning project...").start();
    const [scanResult, adrs] = await Promise.all([
      scanProject({ projectRoot }),
      Promise.resolve(scanAdrDirectory(adrDir)),
    ]);

    const dag = buildDAG(projectRoot, scanResult, adrs);
    // preserve existing snapshots
    dag.snapshots = existing.snapshots;
    // preserve all inferred edges whose from/to still exist in the new DAG
    for (const [id, edge] of Object.entries(existing.edges)) {
      if (edge.certainty === "inferred" && dag.nodes[edge.from] && dag.nodes[edge.to]) {
        if (!dag.edges[id]) {
          dag.edges[id] = edge;
        }
      }
    }

    // Phase 3: Semantic analysis (LLM) — adds new inferred edges
    if (opts.semantic !== false && adrs.length > 0) {
      const client = createSemanticClient();
      if (client) {
        const providerLabel = { anthropic: "Anthropic API", bedrock: "AWS Bedrock", vertex: "Google Vertex AI", compatible: "Compatible API" }[client.provider];
        let verboseLog: { logPath: string; stream: fs.WriteStream } | null = null;
        if (opts.verbose) { verboseLog = createVerboseLog(projectRoot); }
        spinner.text = `Analyzing semantic relationships (${providerLabel})...`;
        try {
          const semResult = await analyzeSemantics(dag, adrs, client, {
            onProgress: (p) => {
              const icon = p.status === "error" ? "✗" : p.status === "done" ? "✓" : "…";
              const tps = p.tokensPerSec ? `  ${p.tokensPerSec} tok/s` : "";
              spinner.text = `[${p.current}/${p.total}] ${icon} ${p.adrId}  (+${p.edgesAdded} edges)${tps}`;
            },
            verbose: opts.verbose,
            verboseStream: verboseLog?.stream,
          });
          if (verboseLog) { verboseLog.stream.end(); await openInEditor(verboseLog.logPath); }
          const avgTps = semResult.totalDurationMs > 0
            ? Math.round((semResult.totalOutputTokens / semResult.totalDurationMs) * 1000)
            : 0;
          if (semResult.edgesAdded > 0) {
            spinner.text = `Re-scan complete (+${semResult.edgesAdded} inferred edges, ${avgTps} tok/s)`;
          }
          if (verboseLog) console.log(chalk.dim(`  Verbose log: ${verboseLog.logPath}`));
          if (semResult.errors.length > 0) {
            for (const err of semResult.errors) {
              console.log(chalk.yellow(`  ⚠ ${err}`));
            }
          }
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          spinner.warn(`Semantic analysis failed: ${msg}`);
        }
      }
    }

    dag.lastUpdatedAt = new Date().toISOString();
    saveDAG(dag, projectRoot);
    spinner.succeed(chalk.green("DAG updated"));

    const stats = computeStats(dag);
    console.log(`\n  Modules: ${stats.moduleCount}  |  ADRs: ${stats.adrCount}  |  Edges: ${stats.totalEdges}  (${stats.certainEdges} certain, ${stats.inferredEdges} inferred)\n`);
  });

// ---- status ------------------------------------------------

program
  .command("status")
  .description("Show DAG summary and binding health")
  .option("-r, --root <path>", "project root", process.cwd())
  .action((opts) => {
    const projectRoot = path.resolve(opts.root);
    const dag = loadDAG(projectRoot);

    if (!dag) {
      console.log(chalk.yellow("No DAG found. Run `adr-graph init` first."));
      process.exit(1);
    }

    const stats = computeStats(dag);
    console.log(chalk.bold("\n📊 adr-graph status\n"));
    console.log(`  Last updated: ${dag.lastUpdatedAt}`);
    console.log(`  Nodes:  ${stats.totalNodes}  (${stats.adrCount} ADRs, ${stats.moduleCount} modules, ${stats.conceptCount} concepts)`);
    console.log(`  Edges:  ${stats.totalEdges}  (${stats.certainEdges} certain ✅, ${stats.inferredEdges} inferred ⚠️ )`);
    console.log(`  ADR↔Module bindings: ${stats.implementsEdges}`);

    // show latest snapshot if available
    if (dag.snapshots.length > 0) {
      const latest = dag.snapshots[dag.snapshots.length - 1];
      console.log(chalk.bold("\n🕐 Latest semantic snapshot:\n"));
      console.log(`  Commit: ${latest.commitHash}`);
      console.log(`  Drift count: ${latest.driftCount}`);

      const drifting = latest.bindings.filter(
        (b) => b.status === "drifting" || b.status === "broken"
      );
      for (const b of drifting) {
        const icon = b.status === "broken" ? "🔴" : "⚠️ ";
        console.log(`  ${icon} ${b.adrId} ↔ ${b.moduleId}: ${b.reason ?? b.status}`);
      }
    } else {
      console.log(chalk.dim("\n  No semantic snapshots yet. Snapshots are created on git commit (hook coming soon).\n"));
    }

    console.log("");
  });

// ---- impact ------------------------------------------------

program
  .command("impact <target>")
  .description("Show which ADRs govern a file, or which modules an ADR affects")
  .option("-r, --root <path>", "project root", process.cwd())
  .action((target, opts) => {
    const projectRoot = path.resolve(opts.root);
    const dag = loadDAG(projectRoot);

    if (!dag) {
      console.log(chalk.yellow("No DAG found. Run `adr-graph init` first."));
      process.exit(1);
    }

    const report = analyzeImpact(target, dag);

    if (!report) {
      console.log(chalk.red(`\nNo node found for "${target}".`));
      console.log(chalk.dim("Use a file path (e.g. src/core/ast/scanner.ts) or an ADR ID (e.g. ADR-001).\n"));
      process.exit(1);
    }

    if (report.kind === "module") {
      console.log(chalk.bold(`\n🎯 Impact: ${report.target.label}\n`));

      // governing ADRs
      if (report.governingAdrs.length > 0) {
        console.log(chalk.bold("  Governing ADRs:"));
        for (const adr of report.governingAdrs) {
          const statusIcon = adr.status === "accepted" ? "✅" : adr.status === "deprecated" ? "⚠️ " : "📝";
          console.log(`    ${statusIcon} ${adr.id}: ${adr.title}  ${chalk.dim(`[${adr.status}]`)}`);
        }
      } else {
        console.log(chalk.dim("  No ADRs govern this module."));
      }

      // siblings
      if (report.siblings.length > 0) {
        console.log(chalk.bold("\n  Sibling modules (share same ADRs):"));
        for (const sib of report.siblings) {
          console.log(`    ${chalk.cyan(sib.label)}`);
        }
      }

      // dependencies
      if (report.dependsOn.length > 0) {
        console.log(chalk.bold("\n  Depends on:"));
        for (const dep of report.dependsOn) {
          console.log(`    → ${dep.label}`);
        }
      }

      if (report.dependedBy.length > 0) {
        console.log(chalk.bold("\n  Depended by:"));
        for (const dep of report.dependedBy) {
          console.log(`    ← ${dep.label}`);
        }
      }
    }

    if (report.kind === "adr") {
      const statusIcon = report.target.status === "accepted" ? "✅" : report.target.status === "deprecated" ? "⚠️ " : "📝";
      console.log(chalk.bold(`\n🎯 Impact: ${report.target.id} — ${report.target.title}  ${statusIcon}\n`));

      // implementing modules
      if (report.implementedBy.length > 0) {
        console.log(chalk.bold("  Implementing modules:"));
        for (const mod of report.implementedBy) {
          console.log(`    ${chalk.cyan(mod.label)}`);
        }
      } else {
        console.log(chalk.dim("  No modules implement this ADR."));
      }

      // supersedes
      if (report.supersedes.length > 0) {
        console.log(chalk.bold("\n  Supersedes:"));
        for (const adr of report.supersedes) {
          console.log(`    → ${adr.id}: ${adr.title}`);
        }
      }

      if (report.supersededBy.length > 0) {
        console.log(chalk.bold("\n  Superseded by:"));
        for (const adr of report.supersededBy) {
          console.log(`    ← ${adr.id}: ${adr.title}`);
        }
      }

      // conflicts
      if (report.conflicts.length > 0) {
        console.log(chalk.bold("\n  Conflicts with:"));
        for (const adr of report.conflicts) {
          console.log(`    ⚠️  ${adr.id}: ${adr.title}`);
        }
      }

      // dependency subgraph
      if (report.dependencySubgraph.length > 0) {
        console.log(chalk.bold("\n  Internal dependencies among affected modules:"));
        for (const edge of report.dependencySubgraph) {
          const fromLabel = dag.nodes[edge.from]?.label ?? edge.from;
          const toLabel = dag.nodes[edge.to]?.label ?? edge.to;
          console.log(`    ${fromLabel} → ${toLabel}`);
        }
      }
    }

    console.log("");
  });

// ---- viz ---------------------------------------------------

program
  .command("viz")
  .description("Generate an interactive HTML visualization of the Semantic DAG")
  .option("-r, --root <path>", "project root", process.cwd())
  .option("-o, --output <path>", "output file path", "adr-graph.html")
  .action(async (opts) => {
    const projectRoot = path.resolve(opts.root);
    const dag = loadDAG(projectRoot);

    if (!dag) {
      console.log(chalk.yellow("No DAG found. Run `adr-graph init` first."));
      process.exit(1);
    }

    const html = generateHTML(dag);
    const outputPath = path.resolve(projectRoot, opts.output);
    fs.writeFileSync(outputPath, html, "utf-8");

    console.log(chalk.bold("\n📊 adr-graph viz\n"));
    console.log(`  Generated: ${chalk.cyan(outputPath)}`);

    // try to open in browser
    const { execSync } = await import("child_process");
    try {
      if (process.platform === "win32") {
        execSync(`start "" "${outputPath}"`, { stdio: "ignore", shell: "cmd.exe" });
      } else {
        const cmd = process.platform === "darwin" ? "open" : "xdg-open";
        execSync(`${cmd} "${outputPath}"`, { stdio: "ignore" });
      }
      console.log(chalk.dim("  Opened in browser.\n"));
    } catch {
      console.log(chalk.dim(`  Open ${outputPath} in your browser.\n`));
    }
  });

program.parse();
