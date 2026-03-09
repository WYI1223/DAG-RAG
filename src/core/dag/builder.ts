/**
 * core/dag/builder.ts
 *
 * Assembles the SemanticDAG from:
 *   - AST scan results (ModuleNode[], depends_on edges)
 *   - ADR parse results (AdrNode[], implements/supersedes edges from frontmatter)
 *
 * This is the cold-start Phase 1 builder.
 * All edges produced here are certainty: "certain" (structural) or 
 * certainty: "inferred" (from frontmatter affects declarations).
 */

import * as path from "path";
import * as crypto from "crypto";
import { SemanticDAG, GraphNode, GraphEdge, AdrNode } from "../../types/graph.js";
import { ScanResult } from "../ast/scanner.js";
import { ParsedAdr } from "./adr-parser.js";

function uid(): string {
  return crypto.randomBytes(4).toString("hex");
}

function edgeId(from: string, to: string, kind: string): string {
  return `${kind}:${from}→${to}`;
}

export function buildDAG(
  projectRoot: string,
  scanResult: ScanResult,
  adrs: ParsedAdr[]
): SemanticDAG {
  const nodes: Record<string, GraphNode> = {};
  const edges: Record<string, GraphEdge> = {};

  // 1. insert all module nodes
  for (const mod of scanResult.modules) {
    nodes[mod.id] = mod;
  }

  // 2. insert all module → module depends_on edges
  for (const edge of scanResult.edges) {
    edges[edge.id] = edge;
  }

  // 3. insert all ADR nodes
  for (const { node } of adrs) {
    nodes[node.id] = node;
  }

  // 4. build structural edges from ADR frontmatter
  for (const { node: adr, frontmatter } of adrs) {
    // supersedes edges (ADR → ADR)
    if (frontmatter.supersedes) {
      const eid = edgeId(adr.id, frontmatter.supersedes, "supersedes");
      edges[eid] = {
        id: eid,
        from: adr.id,
        to: frontmatter.supersedes,
        kind: "supersedes",
        certainty: "certain",   // explicitly declared in frontmatter
      };
    }

    // implements edges (ADR → Module) from affects list
    // These are declared by the author, so certainty = "certain"
    for (const affectsPath of frontmatter.affects ?? []) {
      // resolve affected path to module ids
      const matchingModules = resolveAffectsToModules(
        affectsPath,
        projectRoot,
        scanResult
      );

      for (const moduleId of matchingModules) {
        const eid = edgeId(adr.id, moduleId, "implements");
        edges[eid] = {
          id: eid,
          from: adr.id,
          to: moduleId,
          kind: "implements",
          certainty: "certain",
        };
      }
    }
  }

  const now = new Date().toISOString();

  return {
    version: "1",
    projectRoot,
    createdAt: now,
    lastUpdatedAt: now,
    nodes,
    edges,
    snapshots: [],
  };
}

// ---- resolve an "affects" path string to module node ids ---
// supports both exact file paths and directory prefixes

function resolveAffectsToModules(
  affectsPath: string,
  projectRoot: string,
  scan: ScanResult
): string[] {
  const normalized = affectsPath.replace(/\\/g, "/").replace(/\/$/, "");
  const matched: string[] = [];

  for (const mod of scan.modules) {
    const relPath = path
      .relative(projectRoot, mod.filePath)
      .replace(/\\/g, "/");

    // exact match or prefix match (directory)
    if (relPath === normalized || relPath.startsWith(normalized + "/")) {
      matched.push(mod.id);
    }
  }

  return matched;
}

// ---- DAG stats for display ---------------------------------

export interface DAGStats {
  totalNodes: number;
  adrCount: number;
  moduleCount: number;
  conceptCount: number;
  totalEdges: number;
  certainEdges: number;
  inferredEdges: number;
  implementsEdges: number;
  dependsOnEdges: number;
}

export function computeStats(dag: SemanticDAG): DAGStats {
  const nodes = Object.values(dag.nodes);
  const edges = Object.values(dag.edges);

  return {
    totalNodes: nodes.length,
    adrCount: nodes.filter((n) => n.kind === "adr").length,
    moduleCount: nodes.filter((n) => n.kind === "module").length,
    conceptCount: nodes.filter((n) => n.kind === "concept").length,
    totalEdges: edges.length,
    certainEdges: edges.filter((e) => e.certainty === "certain").length,
    inferredEdges: edges.filter((e) => e.certainty === "inferred").length,
    implementsEdges: edges.filter((e) => e.kind === "implements").length,
    dependsOnEdges: edges.filter((e) => e.kind === "depends_on").length,
  };
}
