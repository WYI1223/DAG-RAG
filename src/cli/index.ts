#!/usr/bin/env node
/**
 * cli/index.ts
 *
 * Commands:
 *   ligare init    — cold-start: scan project, build initial DAG
 *   ligare scan    — re-scan after code changes, update DAG
 *   ligare status  — show current DAG stats and any drift warnings
 *   ligare viz     — generate HTML visualization (coming soon)
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
import { createSemanticClient, analyzeSemantics, checkDrift } from "../core/semantic/index.js";
import { getAffectedModules, getCurrentCommitHash } from "../core/git/diff.js";
import { SemanticSnapshot } from "../types/graph.js";

/** Create a write stream for verbose output; returns the log path and stream */
function createVerboseLog(projectRoot: string, command: string): { logPath: string; stream: fs.WriteStream } {
  const dagDir = path.join(projectRoot, ".ligare");
  if (!fs.existsSync(dagDir)) fs.mkdirSync(dagDir, { recursive: true });
  const now = new Date();
  const ts = now.toISOString().replace(/[-:T]/g, "").slice(0, 12); // YYYYMMDDHHmm
  const logPath = path.join(dagDir, `verbose-${command}-${ts}.log`);
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
  .name("ligare")
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

    console.log(chalk.bold("\n🔍 ligare init\n"));
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
        if (opts.verbose) { verboseLog = createVerboseLog(projectRoot, "init"); }
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
          const cacheTag = semResult.totalCacheReadTokens > 0
            ? `  cache read: ${semResult.totalCacheReadTokens}`
            : "";
          const tokenInfo = semResult.totalOutputTokens > 0
            ? `  (${semResult.totalInputTokens} in / ${semResult.totalOutputTokens} out, ${avgTps} tok/s${cacheTag})`
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
        console.log(chalk.dim("  Semantic layer skipped — set LIGARE_ANTHROPIC_KEY for LLM analysis"));
      }
    }

    saveDAG(dag, projectRoot);
    ensureGitignoreEntry(projectRoot);

    // Summary
    const stats = computeStats(dag);
    console.log(chalk.bold("\n📊 Initial DAG summary:\n"));
    console.log(`  Nodes:  ${stats.totalNodes}  (${stats.adrCount} ADRs, ${stats.moduleCount} modules)`);
    console.log(`  Edges:  ${stats.totalEdges}  (${stats.certainEdges} certain, ${stats.inferredEdges} inferred)`);
    console.log(`  Bindings: ${stats.implementsEdges} implements, ${stats.affectsEdges} affects`);
    console.log(`  Dependencies (Module→Module): ${stats.dependsOnEdges}`);

    if (adrs.length === 0) {
      console.log(chalk.yellow("\n💡 No ADRs found. Create your first one:"));
      console.log(chalk.dim(`   mkdir -p ${opts.adrDir} && touch ${opts.adrDir}/ADR-001-initial-architecture.md`));
      console.log(chalk.dim("   Then run: ligare scan\n"));
    } else {
      console.log(chalk.green("\n✅ Ready. Run `ligare status` to check for drift.\n"));
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
      console.log(chalk.yellow("No DAG found. Run `ligare init` first."));
      process.exit(1);
    }

    console.log(chalk.bold("\n🔄 ligare scan\n"));

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
        if (opts.verbose) { verboseLog = createVerboseLog(projectRoot, "scan"); }
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
      console.log(chalk.yellow("No DAG found. Run `ligare init` first."));
      process.exit(1);
    }

    const stats = computeStats(dag);
    console.log(chalk.bold("\n📊 ligare status\n"));
    console.log(`  Last updated: ${dag.lastUpdatedAt}`);
    console.log(`  Nodes:  ${stats.totalNodes}  (${stats.adrCount} ADRs, ${stats.moduleCount} modules, ${stats.conceptCount} concepts)`);
    console.log(`  Edges:  ${stats.totalEdges}  (${stats.certainEdges} certain ✅, ${stats.inferredEdges} inferred ⚠️ )`);
    console.log(`  ADR↔Module bindings: ${stats.implementsEdges} implements, ${stats.affectsEdges} affects`);

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
      console.log(chalk.yellow("No DAG found. Run `ligare init` first."));
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
  .option("-o, --output <path>", "output file path", "ligare.html")
  .action(async (opts) => {
    const projectRoot = path.resolve(opts.root);
    const dag = loadDAG(projectRoot);

    if (!dag) {
      console.log(chalk.yellow("No DAG found. Run `ligare init` first."));
      process.exit(1);
    }

    const html = generateHTML(dag);
    const outputPath = path.resolve(projectRoot, opts.output);
    fs.writeFileSync(outputPath, html, "utf-8");

    console.log(chalk.bold("\n📊 ligare viz\n"));
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

// ---- check -------------------------------------------------

program
  .command("check [target]")
  .description("Check ADR↔Module bindings for drift (requires LLM)")
  .option("-r, --root <path>", "project root", process.cwd())
  .option("--adr-dir <path>", "ADR directory", "docs/adrs")
  .option("--all", "check all bindings including previously possibly-related ones")
  .option("--changed", "only check bindings affected by git changes since last check")
  .option("--ref <ref>", "git ref to diff against (used with --changed)")
  .option("--verbose", "show raw LLM prompts and responses")
  .action(async (target, opts) => {
    const projectRoot = path.resolve(opts.root);
    const adrDir = path.resolve(projectRoot, opts.adrDir);
    const dag = loadDAG(projectRoot);

    if (!dag) {
      console.log(chalk.yellow("No DAG found. Run `ligare init` first."));
      process.exit(1);
    }

    const client = createSemanticClient();
    if (!client) {
      console.log(chalk.yellow("No LLM credentials found. Set LIGARE_ANTHROPIC_KEY (or other provider env vars)."));
      process.exit(1);
    }

    const adrs = scanAdrDirectory(adrDir);
    if (adrs.length === 0) {
      console.log(chalk.yellow("No ADRs found. Nothing to check."));
      process.exit(0);
    }

    // determine filter
    const filterAdr = target?.startsWith("ADR-") ? target : undefined;
    const filterModule = target && !target.startsWith("ADR-")
      ? `mod:${target.replace(/\\/g, "/")}`
      : undefined;

    const providerLabel = { anthropic: "Anthropic API", bedrock: "AWS Bedrock", vertex: "Google Vertex AI", compatible: "Compatible API" }[client.provider];
    console.log(chalk.bold("\n🔍 ligare check\n"));
    if (target) {
      console.log(chalk.dim(`  Target: ${target}`));
    }
    console.log(chalk.dim(`  Provider: ${providerLabel}`));

    // --changed: git-aware incremental filtering
    let filterModuleIds: Set<string> | undefined;
    if (opts.changed) {
      try {
        const diff = getAffectedModules(projectRoot, dag, { userRef: opts.ref });
        filterModuleIds = diff.affectedModuleIds;
        console.log(chalk.dim(`  Git ref: ${diff.ref}`));
        console.log(chalk.dim(`  Changed files: ${diff.changedFiles.length}`));
        console.log(chalk.dim(`  Affected modules: ${diff.affectedModuleIds.size} (${diff.directModuleCount} from code, ${diff.adrExpandedModuleCount} from ADRs)`));
        if (diff.affectedModuleIds.size === 0) {
          console.log(chalk.green("\n  No modules affected by recent changes. Nothing to check.\n"));
          process.exit(0);
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.log(chalk.yellow(`  --changed failed: ${msg}`));
        console.log(chalk.dim("  Falling back to full check.\n"));
      }
    }

    console.log("");
    const spinner = ora("Checking bindings for drift...").start();
    let verboseLog: { logPath: string; stream: fs.WriteStream } | null = null;
    if (opts.verbose) { verboseLog = createVerboseLog(projectRoot, "check"); }

    try {
      const result = await checkDrift(dag, adrs, client, {
        filterAdr,
        filterModule,
        filterModuleIds,
        checkAll: opts.all,
        onProgress: (p) => {
          const tps = p.tokensPerSec ? `  ${p.tokensPerSec} tok/s` : "";
          spinner.text = `[${p.current}/${p.total}] ${p.adrId} → ${p.moduleId}${tps}`;
        },
        verbose: opts.verbose,
        verboseStream: verboseLog?.stream,
      });

      if (verboseLog) { verboseLog.stream.end(); }
      spinner.stop();

      if (result.bindingsChecked === 0) {
        console.log(chalk.yellow("  No ADR↔Module bindings found to check."));
        if (target) {
          console.log(chalk.dim(`  Ensure "${target}" has implements/affects edges in the DAG.\n`));
        }
        process.exit(0);
      }

      // display results
      console.log(chalk.bold("  Results:\n"));
      for (const b of result.bindings) {
        const modNode = dag.nodes[b.moduleId];
        const modLabel = modNode?.label ?? b.moduleId;
        const reason = b.reason
          ?.replace("[UNRELATED] ", "")
          .replace("[POSSIBLY_RELATED] ", "");

        const isUnrelated = b.reason?.startsWith("[UNRELATED]");
        const isPossiblyRelated = b.reason?.startsWith("[POSSIBLY_RELATED]");

        if (isUnrelated) {
          console.log(chalk.gray(`  ✖ ${b.adrId} ↔ ${modLabel}`) + chalk.dim("  [unrelated — removed]"));
          console.log(chalk.dim(`     ${reason}`));
        } else if (isPossiblyRelated) {
          console.log(chalk.cyan(`  ? ${b.adrId} ↔ ${modLabel}`) + chalk.dim("  [possibly related]"));
          console.log(chalk.dim(`     ${reason}`));
        } else if (b.status === "aligned") {
          console.log(chalk.green(`  ✅ ${b.adrId} ↔ ${modLabel}`) + chalk.dim("  [aligned]"));
        } else if (b.status === "drifting") {
          console.log(chalk.yellow(`  ⚠️  ${b.adrId} ↔ ${modLabel}`) + chalk.dim("  [drifting]"));
          console.log(chalk.dim(`     ${reason}`));
        } else if (b.status === "broken") {
          console.log(chalk.red(`  🔴 ${b.adrId} ↔ ${modLabel}`) + chalk.dim("  [broken]"));
          console.log(chalk.dim(`     ${reason}`));
        }
      }

      // apply DAG mutations: remove unrelated edges, mark possibly_related
      let dagChanged = false;
      for (const edgeId of result.prunedEdgeIds) {
        if (dag.edges[edgeId]) {
          delete dag.edges[edgeId];
          dagChanged = true;
        }
      }
      for (const edgeId of result.possiblyRelatedEdgeIds) {
        if (dag.edges[edgeId]) {
          dag.edges[edgeId].metadata = {
            ...dag.edges[edgeId].metadata,
            relevance: "possibly_related",
          };
          dagChanged = true;
        }
      }
      // Create semantic snapshot anchored to current commit
      try {
        const commitHash = getCurrentCommitHash(projectRoot);
        const snapshot: SemanticSnapshot = {
          commitHash,
          timestamp: new Date().toISOString(),
          bindings: result.bindings,
          driftCount: result.drifting + result.broken,
        };
        dag.snapshots.push(snapshot);
        dagChanged = true;
      } catch {
        // not a git repo or no commits — skip snapshot
      }

      if (dagChanged) {
        dag.lastUpdatedAt = new Date().toISOString();
        saveDAG(dag, projectRoot);
      }

      // summary
      const avgTps = result.totalDurationMs > 0
        ? Math.round((result.totalOutputTokens / result.totalDurationMs) * 1000)
        : 0;
      console.log(chalk.bold("\n  Summary:"));
      console.log(`    Bindings checked: ${result.bindingsChecked}`);
      const unrelatedInfo = result.unrelated > 0 ? `  ${chalk.gray("Unrelated")}: ${result.unrelated}` : "";
      const possiblyInfo = result.possiblyRelated > 0 ? `  ${chalk.cyan("Possibly")}: ${result.possiblyRelated}` : "";
      console.log(`    ${chalk.green("Aligned")}: ${result.aligned}  ${chalk.yellow("Drifting")}: ${result.drifting}  ${chalk.red("Broken")}: ${result.broken}${unrelatedInfo}${possiblyInfo}`);
      const cacheInfo = result.totalCacheReadTokens > 0
        ? `  cache read: ${result.totalCacheReadTokens}`
        : "";
      const cacheCreateInfo = result.totalCacheCreationTokens > 0
        ? `  cache write: ${result.totalCacheCreationTokens}`
        : "";
      console.log(chalk.dim(`    Tokens: ${result.totalInputTokens} in / ${result.totalOutputTokens} out  (${avgTps} tok/s)${cacheInfo}${cacheCreateInfo}`));

      if (result.prunedEdgeIds.length > 0) {
        console.log(chalk.dim(`    ✖ Removed ${result.prunedEdgeIds.length} unrelated bindings from DAG`));
      }
      if (result.possiblyRelatedEdgeIds.length > 0) {
        console.log(chalk.dim(`    ? Marked ${result.possiblyRelatedEdgeIds.length} possibly-related bindings (skipped next time, use --all to include)`));
      }
      if (result.skippedPreviouslyResolved > 0) {
        console.log(chalk.dim(`    ℹ Skipped ${result.skippedPreviouslyResolved} previously resolved bindings (use --all to re-check)`));
      }
      if (verboseLog) console.log(chalk.dim(`    Verbose log: ${verboseLog.logPath}`));
      if (result.errors.length > 0) {
        console.log(chalk.yellow("\n  Errors:"));
        for (const err of result.errors) {
          console.log(chalk.yellow(`    ⚠ ${err}`));
        }
      }
      console.log("");
    } catch (e) {
      if (verboseLog) { verboseLog.stream.end(); }
      spinner.fail("Drift check failed");
      console.error(e);
      process.exit(1);
    }
  });

program.parse();
