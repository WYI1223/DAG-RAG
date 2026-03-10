/**
 * core/git/diff.ts
 *
 * Git-aware incremental checking.
 * Extracts changed files from git diff and maps them to DAG node IDs,
 * enabling `check --changed` to only process affected bindings.
 */

import { execSync } from "child_process";
import * as path from "path";
import { SemanticDAG, AdrNode, ModuleNode } from "../../types/graph.js";

// ---- types --------------------------------------------------

export interface ChangedNodes {
  /** Module IDs directly changed (e.g. "module:src/core/ast/scanner.ts") */
  moduleIds: Set<string>;
  /** ADR IDs directly changed (e.g. "ADR-001") */
  adrIds: Set<string>;
  /** Raw changed file paths (relative, forward slashes) */
  changedFiles: string[];
}

export interface GitDiffSummary {
  /** Git ref that was diffed against */
  ref: string;
  /** All changed file paths */
  changedFiles: string[];
  /** Module IDs to check (direct changes + ADR-expanded) */
  affectedModuleIds: Set<string>;
  /** Number of modules from direct code changes */
  directModuleCount: number;
  /** Number of modules from changed ADRs */
  adrExpandedModuleCount: number;
}

// ---- git operations -----------------------------------------

export type GitExecutor = (cmd: string, cwd: string) => string;

function defaultExecutor(cmd: string, cwd: string): string {
  return execSync(cmd, { cwd, encoding: "utf-8", timeout: 10000, stdio: ["pipe", "pipe", "pipe"] }).trim();
}

/** Get the current HEAD commit hash */
export function getCurrentCommitHash(
  projectRoot: string,
  exec: GitExecutor = defaultExecutor,
): string {
  return exec("git rev-parse HEAD", projectRoot);
}

/** Validate that a git ref exists */
export function isValidRef(
  ref: string,
  projectRoot: string,
  exec: GitExecutor = defaultExecutor,
): boolean {
  try {
    exec(`git rev-parse --verify ${ref}`, projectRoot);
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve the git ref to diff against.
 * Priority: user-specified ref > latest snapshot commitHash > HEAD~1
 */
export function resolveGitRef(
  projectRoot: string,
  opts: {
    userRef?: string;
    snapshotCommitHash?: string;
    exec?: GitExecutor;
  } = {},
): { ref: string; source: "user" | "snapshot" | "fallback" } {
  const exec = opts.exec ?? defaultExecutor;

  if (opts.userRef) {
    if (!isValidRef(opts.userRef, projectRoot, exec)) {
      throw new Error(`Invalid git ref: ${opts.userRef}`);
    }
    return { ref: opts.userRef, source: "user" };
  }

  if (opts.snapshotCommitHash) {
    if (isValidRef(opts.snapshotCommitHash, projectRoot, exec)) {
      return { ref: opts.snapshotCommitHash, source: "snapshot" };
    }
    // snapshot commit may have been rebased away — fall through
  }

  return { ref: "HEAD~1", source: "fallback" };
}

/**
 * Get files changed between a ref and the current working tree.
 * Includes: committed changes since ref, staged changes, and modified unstaged files.
 */
export function getChangedFiles(
  projectRoot: string,
  ref: string,
  exec: GitExecutor = defaultExecutor,
): string[] {
  const files = new Set<string>();

  // Changes between ref and HEAD (committed)
  try {
    const committed = exec(`git diff --name-only ${ref} HEAD`, projectRoot);
    for (const f of committed.split("\n")) {
      if (f.trim()) files.add(f.trim().replace(/\\/g, "/"));
    }
  } catch {
    // ref might not exist for HEAD~1 on first commit
  }

  // Staged but not yet committed
  try {
    const staged = exec("git diff --name-only --cached", projectRoot);
    for (const f of staged.split("\n")) {
      if (f.trim()) files.add(f.trim().replace(/\\/g, "/"));
    }
  } catch {
    // ignore
  }

  // Unstaged modifications in working tree
  try {
    const unstaged = exec("git diff --name-only", projectRoot);
    for (const f of unstaged.split("\n")) {
      if (f.trim()) files.add(f.trim().replace(/\\/g, "/"));
    }
  } catch {
    // ignore
  }

  return [...files].sort();
}

// ---- DAG mapping --------------------------------------------

/**
 * Map changed file paths to DAG node IDs.
 * A file maps to a module if `module:<relativePath>` exists in the DAG.
 * A file maps to an ADR if its path matches an ADR node's filePath.
 */
export function mapChangedFilesToNodes(
  changedFiles: string[],
  dag: SemanticDAG,
): ChangedNodes {
  const moduleIds = new Set<string>();
  const adrIds = new Set<string>();

  // Build reverse lookup: relative filePath → ADR node id
  const adrPathMap = new Map<string, string>();
  for (const node of Object.values(dag.nodes)) {
    if (node.kind === "adr") {
      const rel = path
        .relative(dag.projectRoot, (node as AdrNode).filePath)
        .replace(/\\/g, "/");
      adrPathMap.set(rel, node.id);
    }
  }

  for (const file of changedFiles) {
    // Check if it's a module
    const moduleId = `module:${file}`;
    if (dag.nodes[moduleId]) {
      moduleIds.add(moduleId);
    }

    // Check if it's an ADR
    const adrId = adrPathMap.get(file);
    if (adrId) {
      adrIds.add(adrId);
    }
  }

  return { moduleIds, adrIds, changedFiles };
}

/**
 * Expand changed ADR IDs to the set of module IDs bound to those ADRs
 * via implements or affects edges.
 */
export function expandAdrChangesToModules(
  adrIds: Set<string>,
  dag: SemanticDAG,
): Set<string> {
  const moduleIds = new Set<string>();

  for (const edge of Object.values(dag.edges)) {
    if (
      (edge.kind === "implements" || edge.kind === "affects") &&
      adrIds.has(edge.from)
    ) {
      const toNode = dag.nodes[edge.to];
      if (toNode?.kind === "module" && (toNode as ModuleNode).language !== "external") {
        moduleIds.add(edge.to);
      }
    }
  }

  return moduleIds;
}

// ---- orchestration ------------------------------------------

/**
 * Full pipeline: resolve ref → get changed files → map to nodes → expand ADRs.
 * Returns the set of module IDs that need re-checking.
 */
export function getAffectedModules(
  projectRoot: string,
  dag: SemanticDAG,
  opts: {
    userRef?: string;
    exec?: GitExecutor;
  } = {},
): GitDiffSummary {
  const exec = opts.exec ?? defaultExecutor;

  // Resolve ref
  const latestSnapshot =
    dag.snapshots.length > 0
      ? dag.snapshots[dag.snapshots.length - 1]
      : undefined;

  const { ref } = resolveGitRef(projectRoot, {
    userRef: opts.userRef,
    snapshotCommitHash: latestSnapshot?.commitHash,
    exec,
  });

  // Get changed files
  const changedFiles = getChangedFiles(projectRoot, ref, exec);

  // Map to DAG nodes
  const { moduleIds: directModules, adrIds } = mapChangedFilesToNodes(
    changedFiles,
    dag,
  );

  // Expand ADR changes to affected modules
  const adrExpanded = expandAdrChangesToModules(adrIds, dag);

  // Union
  const affectedModuleIds = new Set([...directModules, ...adrExpanded]);

  return {
    ref,
    changedFiles,
    affectedModuleIds,
    directModuleCount: directModules.size,
    adrExpandedModuleCount: adrExpanded.size,
  };
}
