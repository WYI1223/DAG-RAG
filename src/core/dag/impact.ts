/**
 * core/dag/impact.ts
 *
 * Graph traversal for impact analysis.
 * Given a file path or ADR ID, walks the DAG to find:
 *   - governing ADRs / implementing modules
 *   - sibling modules (share the same ADR binding)
 *   - upstream and downstream dependencies
 *   - supersedes / conflicts relationships
 */

import * as path from "path";
import {
  SemanticDAG,
  GraphNode,
  GraphEdge,
  AdrNode,
  ModuleNode,
} from "../../types/graph.js";

// ------ Impact report types ---------------------------------

export interface ModuleImpact {
  kind: "module";
  target: ModuleNode;
  governingAdrs: AdrNode[];
  siblings: ModuleNode[];        // other modules sharing same ADRs
  dependsOn: ModuleNode[];       // this module imports these
  dependedBy: ModuleNode[];      // these modules import this one
}

export interface AdrImpact {
  kind: "adr";
  target: AdrNode;
  implementedBy: ModuleNode[];   // modules bound to this ADR
  supersedes: AdrNode[];         // ADRs this one replaces
  supersededBy: AdrNode[];       // ADRs that replace this one
  conflicts: AdrNode[];          // potentially conflicting ADRs
  dependencySubgraph: GraphEdge[]; // depends_on edges among implementing modules
}

export type ImpactReport = ModuleImpact | AdrImpact;

// ------ Resolve input to a node ID --------------------------

export function resolveTarget(
  input: string,
  dag: SemanticDAG
): GraphNode | null {
  // direct ID match (e.g. "ADR-001")
  if (dag.nodes[input]) return dag.nodes[input];

  // try as module id
  const asModuleId = `module:${input.replace(/\\/g, "/")}`;
  if (dag.nodes[asModuleId]) return dag.nodes[asModuleId];

  // try matching by relative file path
  const normalized = input.replace(/\\/g, "/");
  for (const node of Object.values(dag.nodes)) {
    if (node.kind === "module" || node.kind === "adr") {
      const rel = path
        .relative(dag.projectRoot, node.filePath)
        .replace(/\\/g, "/");
      if (rel === normalized) return node;
    }
  }

  return null;
}

// ------ helpers ---------------------------------------------

function edgesFrom(dag: SemanticDAG, nodeId: string): GraphEdge[] {
  return Object.values(dag.edges).filter((e) => e.from === nodeId);
}

function edgesTo(dag: SemanticDAG, nodeId: string): GraphEdge[] {
  return Object.values(dag.edges).filter((e) => e.to === nodeId);
}

function getNode<T extends GraphNode>(dag: SemanticDAG, id: string): T | null {
  return (dag.nodes[id] as T) ?? null;
}

// ------ module impact analysis ------------------------------

function analyzeModule(target: ModuleNode, dag: SemanticDAG): ModuleImpact {
  // ADRs that govern this module (implements edges pointing TO this module)
  const governingAdrs: AdrNode[] = edgesTo(dag, target.id)
    .filter((e) => e.kind === "implements")
    .map((e) => getNode<AdrNode>(dag, e.from))
    .filter((n): n is AdrNode => n !== null);

  // sibling modules: other modules that share the same governing ADRs
  const siblingSet = new Set<string>();
  for (const adr of governingAdrs) {
    for (const edge of edgesFrom(dag, adr.id)) {
      if (edge.kind === "implements" && edge.to !== target.id) {
        siblingSet.add(edge.to);
      }
    }
  }
  const siblings: ModuleNode[] = [...siblingSet]
    .map((id) => getNode<ModuleNode>(dag, id))
    .filter((n): n is ModuleNode => n !== null);

  // downstream: modules this one depends on
  const dependsOn: ModuleNode[] = edgesFrom(dag, target.id)
    .filter((e) => e.kind === "depends_on")
    .map((e) => getNode<ModuleNode>(dag, e.to))
    .filter((n): n is ModuleNode => n !== null);

  // upstream: modules that depend on this one
  const dependedBy: ModuleNode[] = edgesTo(dag, target.id)
    .filter((e) => e.kind === "depends_on")
    .map((e) => getNode<ModuleNode>(dag, e.from))
    .filter((n): n is ModuleNode => n !== null);

  return { kind: "module", target, governingAdrs, siblings, dependsOn, dependedBy };
}

// ------ ADR impact analysis ---------------------------------

function analyzeAdr(target: AdrNode, dag: SemanticDAG): AdrImpact {
  // modules that implement this ADR
  const implementedBy: ModuleNode[] = edgesFrom(dag, target.id)
    .filter((e) => e.kind === "implements")
    .map((e) => getNode<ModuleNode>(dag, e.to))
    .filter((n): n is ModuleNode => n !== null);

  // ADRs this one supersedes
  const supersedes: AdrNode[] = edgesFrom(dag, target.id)
    .filter((e) => e.kind === "supersedes")
    .map((e) => getNode<AdrNode>(dag, e.to))
    .filter((n): n is AdrNode => n !== null);

  // ADRs that supersede this one
  const supersededBy: AdrNode[] = edgesTo(dag, target.id)
    .filter((e) => e.kind === "supersedes")
    .map((e) => getNode<AdrNode>(dag, e.from))
    .filter((n): n is AdrNode => n !== null);

  // conflicting ADRs (either direction)
  const conflictSet = new Set<string>();
  for (const e of edgesFrom(dag, target.id)) {
    if (e.kind === "conflicts") conflictSet.add(e.to);
  }
  for (const e of edgesTo(dag, target.id)) {
    if (e.kind === "conflicts") conflictSet.add(e.from);
  }
  const conflicts: AdrNode[] = [...conflictSet]
    .map((id) => getNode<AdrNode>(dag, id))
    .filter((n): n is AdrNode => n !== null);

  // dependency subgraph: depends_on edges among implementing modules
  const moduleIds = new Set(implementedBy.map((m) => m.id));
  const dependencySubgraph: GraphEdge[] = Object.values(dag.edges).filter(
    (e) =>
      e.kind === "depends_on" &&
      moduleIds.has(e.from) &&
      moduleIds.has(e.to)
  );

  return {
    kind: "adr",
    target,
    implementedBy,
    supersedes,
    supersededBy,
    conflicts,
    dependencySubgraph,
  };
}

// ------ main entry point ------------------------------------

export function analyzeImpact(
  input: string,
  dag: SemanticDAG
): ImpactReport | null {
  const target = resolveTarget(input, dag);
  if (!target) return null;

  if (target.kind === "module") {
    return analyzeModule(target as ModuleNode, dag);
  }
  if (target.kind === "adr") {
    return analyzeAdr(target as AdrNode, dag);
  }

  return null;
}
