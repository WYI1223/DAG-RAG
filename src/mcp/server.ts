#!/usr/bin/env node

/**
 * mcp/server.ts
 *
 * MCP Server for IDE integration (ADR-027).
 * Exposes ligare's DAG queries and drift checking as callable tools
 * over stdio transport.
 */

import "dotenv/config";
import * as path from "path";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { loadDAG, saveDAG } from "../core/dag/store.js";
import { computeStats } from "../core/dag/builder.js";
import {
  analyzeImpact,
  type ModuleImpact,
  type AdrImpact,
} from "../core/dag/impact.js";
import { scanAdrDirectory } from "../core/dag/adr-parser.js";
import {
  createSemanticClient,
  checkDrift,
} from "../core/semantic/index.js";
import {
  getAffectedModules,
  getCurrentCommitHash,
} from "../core/git/diff.js";
import type {
  SemanticDAG,
  SemanticBinding,
  SemanticSnapshot,
} from "../types/graph.js";

// ---- helpers ------------------------------------------------

function resolveRoot(root?: string): string {
  return path.resolve(root ?? process.cwd());
}

function requireDAG(projectRoot: string): SemanticDAG {
  const dag = loadDAG(projectRoot);
  if (!dag) {
    throw new Error(
      `No DAG found at ${projectRoot}. Run \`ligare init\` first.`
    );
  }
  return dag;
}

function errorResult(message: string) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify({ error: message }) }],
    isError: true as const,
  };
}

function jsonResult(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  };
}

// ---- server -------------------------------------------------

const server = new McpServer({
  name: "ligare",
  version: "0.3.0",
});

// ---- tool: ligare_status ------------------------------------

server.tool(
  "ligare_status",
  "DAG summary: node/edge counts, binding stats, latest snapshot. No LLM required.",
  { root: z.string().optional().describe("Project root path (defaults to cwd)") },
  async ({ root }) => {
    const projectRoot = resolveRoot(root);
    const dag = requireDAG(projectRoot);
    const stats = computeStats(dag);

    const result: Record<string, unknown> = {
      projectRoot: dag.projectRoot,
      lastUpdatedAt: dag.lastUpdatedAt,
      nodes: {
        total: stats.totalNodes,
        adrs: stats.adrCount,
        modules: stats.moduleCount,
        concepts: stats.conceptCount,
      },
      edges: {
        total: stats.totalEdges,
        certain: stats.certainEdges,
        inferred: stats.inferredEdges,
        implements: stats.implementsEdges,
        affects: stats.affectsEdges,
        dependsOn: stats.dependsOnEdges,
      },
    };

    if (dag.snapshots.length > 0) {
      const latest = dag.snapshots[dag.snapshots.length - 1];
      const drifting = latest.bindings.filter(
        (b) => b.status === "drifting" || b.status === "broken"
      );
      result.latestSnapshot = {
        commitHash: latest.commitHash,
        timestamp: latest.timestamp,
        driftCount: latest.driftCount,
        bindingCount: latest.bindings.length,
        driftingBindings: drifting.map((b) => ({
          adrId: b.adrId,
          moduleId: b.moduleId,
          status: b.status,
          reason: b.reason,
        })),
      };
    }

    return jsonResult(result);
  },
);

// ---- tool: ligare_impact ------------------------------------

server.tool(
  "ligare_impact",
  "Impact analysis: governing ADRs, affected modules, siblings, dependency subgraph. No LLM required.",
  {
    target: z.string().describe("File path (e.g. src/core/ast/scanner.ts) or ADR ID (e.g. ADR-001)"),
    root: z.string().optional().describe("Project root path (defaults to cwd)"),
  },
  async ({ target, root }) => {
    const projectRoot = resolveRoot(root);
    const dag = requireDAG(projectRoot);
    const report = analyzeImpact(target, dag);

    if (!report) {
      return errorResult(`No node found for "${target}". Use a file path or ADR ID.`);
    }

    if (report.kind === "module") {
      const r = report as ModuleImpact;
      return jsonResult({
        kind: "module",
        target: { id: r.target.id, label: r.target.label, filePath: r.target.filePath },
        governingAdrs: r.governingAdrs.map((a) => ({
          id: a.id,
          title: a.title,
          status: a.status,
        })),
        siblings: r.siblings.map((m) => ({ id: m.id, label: m.label })),
        dependsOn: r.dependsOn.map((m) => ({ id: m.id, label: m.label })),
        dependedBy: r.dependedBy.map((m) => ({ id: m.id, label: m.label })),
      });
    }

    const r = report as AdrImpact;
    return jsonResult({
      kind: "adr",
      target: { id: r.target.id, title: r.target.title, status: r.target.status },
      implementedBy: r.implementedBy.map((m) => ({ id: m.id, label: m.label })),
      supersedes: r.supersedes.map((a) => ({ id: a.id, title: a.title })),
      supersededBy: r.supersededBy.map((a) => ({ id: a.id, title: a.title })),
      conflicts: r.conflicts.map((a) => ({ id: a.id, title: a.title })),
      dependencySubgraph: r.dependencySubgraph.map((e) => ({
        from: e.from,
        to: e.to,
        fromLabel: dag.nodes[e.from]?.label ?? e.from,
        toLabel: dag.nodes[e.to]?.label ?? e.to,
      })),
    });
  },
);

// ---- tool: ligare_bindings ----------------------------------

server.tool(
  "ligare_bindings",
  "List ADR↔Module bindings with metadata: edge kind, certainty, last check status. No LLM required.",
  {
    target: z.string().optional().describe("Filter by ADR ID or module path. Omit to list all."),
    root: z.string().optional().describe("Project root path (defaults to cwd)"),
  },
  async ({ target, root }) => {
    const projectRoot = resolveRoot(root);
    const dag = requireDAG(projectRoot);

    // Build lookup from latest snapshot
    const latestSnapshot =
      dag.snapshots.length > 0
        ? dag.snapshots[dag.snapshots.length - 1]
        : null;
    const bindingStatusMap = new Map<string, SemanticBinding>();
    if (latestSnapshot) {
      for (const b of latestSnapshot.bindings) {
        bindingStatusMap.set(`${b.adrId}|${b.moduleId}`, b);
      }
    }

    const bindings: Record<string, unknown>[] = [];
    for (const edge of Object.values(dag.edges)) {
      if (edge.kind !== "implements" && edge.kind !== "affects") continue;
      const fromNode = dag.nodes[edge.from];
      const toNode = dag.nodes[edge.to];
      if (!fromNode || !toNode) continue;
      if (fromNode.kind !== "adr" || toNode.kind !== "module") continue;

      if (target) {
        const normalized = target.replace(/\\/g, "/");
        const matchesAdr = fromNode.id === target;
        const matchesModule =
          toNode.id === normalized ||
          toNode.id === `module:${normalized}`;
        if (!matchesAdr && !matchesModule) continue;
      }

      const snapshotBinding = bindingStatusMap.get(
        `${fromNode.id}|${toNode.id}`
      );

      bindings.push({
        edgeId: edge.id,
        adrId: fromNode.id,
        adrTitle: (fromNode as any).title,
        moduleId: toNode.id,
        moduleLabel: toNode.label,
        edgeKind: edge.kind,
        certainty: edge.certainty,
        relevance: edge.metadata?.relevance ?? null,
        lastCheck: snapshotBinding
          ? {
              status: snapshotBinding.status,
              reason: snapshotBinding.reason,
              checkedAt: snapshotBinding.checkedAt,
            }
          : null,
      });
    }

    return jsonResult({
      bindingCount: bindings.length,
      filter: target ?? null,
      bindings,
    });
  },
);

// ---- tool: ligare_check -------------------------------------

server.tool(
  "ligare_check",
  "Run drift detection on ADR↔Module bindings using LLM. Requires LIGARE_ANTHROPIC_KEY. Blocks until complete.",
  {
    target: z.string().optional().describe("ADR ID or module path to check. Omit for all."),
    changed: z.boolean().optional().describe("Only check bindings affected by git changes since last snapshot."),
    ref: z.string().optional().describe("Git ref to diff against (used with changed)."),
    checkAll: z.boolean().optional().describe("Re-check previously possibly-related bindings too."),
    root: z.string().optional().describe("Project root path (defaults to cwd)"),
    adrDir: z.string().optional().describe("ADR directory relative to root (defaults to docs/adrs)"),
  },
  async ({ target, changed, ref, checkAll, root, adrDir }) => {
    const projectRoot = resolveRoot(root);
    const dag = requireDAG(projectRoot);
    const adrDirResolved = path.resolve(projectRoot, adrDir ?? "docs/adrs");

    const client = createSemanticClient();
    if (!client) {
      return errorResult(
        "No LLM credentials found. Set LIGARE_ANTHROPIC_KEY in the MCP server environment."
      );
    }

    const adrs = scanAdrDirectory(adrDirResolved);
    if (adrs.length === 0) {
      return errorResult("No ADRs found. Nothing to check.");
    }

    // Determine filters
    const filterAdr = target?.startsWith("ADR-") ? target : undefined;
    const filterModule =
      target && !target.startsWith("ADR-")
        ? `module:${target.replace(/\\/g, "/")}`
        : undefined;

    let filterModuleIds: Set<string> | undefined;
    if (changed) {
      try {
        const diff = getAffectedModules(projectRoot, dag, { userRef: ref });
        filterModuleIds = diff.affectedModuleIds;
        if (diff.affectedModuleIds.size === 0) {
          return jsonResult({
            message: "No modules affected by recent changes. Nothing to check.",
            ref: diff.ref,
            changedFiles: diff.changedFiles.length,
          });
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`[ligare-mcp] --changed failed: ${msg}, falling back to full check`);
      }
    }

    const checkResult = await checkDrift(dag, adrs, client, {
      filterAdr,
      filterModule,
      filterModuleIds,
      checkAll: checkAll ?? false,
    });

    // Apply DAG mutations (same as CLI)
    let dagChanged = false;
    for (const edgeId of checkResult.prunedEdgeIds) {
      if (dag.edges[edgeId]) {
        delete dag.edges[edgeId];
        dagChanged = true;
      }
    }
    for (const edgeId of checkResult.possiblyRelatedEdgeIds) {
      if (dag.edges[edgeId]) {
        dag.edges[edgeId].metadata = {
          ...dag.edges[edgeId].metadata,
          relevance: "possibly_related",
        };
        dagChanged = true;
      }
    }

    // Create semantic snapshot
    try {
      const commitHash = getCurrentCommitHash(projectRoot);
      const snapshot: SemanticSnapshot = {
        commitHash,
        timestamp: new Date().toISOString(),
        bindings: checkResult.bindings,
        driftCount: checkResult.drifting + checkResult.broken,
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

    return jsonResult({
      bindingsChecked: checkResult.bindingsChecked,
      aligned: checkResult.aligned,
      drifting: checkResult.drifting,
      broken: checkResult.broken,
      unrelated: checkResult.unrelated,
      possiblyRelated: checkResult.possiblyRelated,
      skippedPreviouslyResolved: checkResult.skippedPreviouslyResolved,
      errors: checkResult.errors,
      bindings: checkResult.bindings.map((b) => ({
        adrId: b.adrId,
        moduleId: b.moduleId,
        status: b.status,
        reason: b.reason,
        checkedAt: b.checkedAt,
      })),
      tokens: {
        input: checkResult.totalInputTokens,
        output: checkResult.totalOutputTokens,
        cacheRead: checkResult.totalCacheReadTokens,
        durationMs: checkResult.totalDurationMs,
      },
    });
  },
);

// ---- start --------------------------------------------------

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[ligare-mcp] Server started on stdio");
}

main().catch((err) => {
  console.error("[ligare-mcp] Fatal error:", err);
  process.exit(1);
});
