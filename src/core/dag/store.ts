/**
 * core/dag/store.ts
 *
 * Reads and writes the SemanticDAG to .adr-graph/dag.json
 * This file lives in the project repo and is versioned with git.
 */

import * as fs from "fs";
import * as path from "path";
import { SemanticDAG } from "../../types/graph.js";

const GRAPH_DIR = ".adr-graph";
const DAG_FILE = "dag.json";

export function getGraphDir(projectRoot: string): string {
  return path.join(projectRoot, GRAPH_DIR);
}

export function getDagPath(projectRoot: string): string {
  return path.join(projectRoot, GRAPH_DIR, DAG_FILE);
}

export function loadDAG(projectRoot: string): SemanticDAG | null {
  const dagPath = getDagPath(projectRoot);
  if (!fs.existsSync(dagPath)) return null;

  try {
    const raw = fs.readFileSync(dagPath, "utf-8");
    return JSON.parse(raw) as SemanticDAG;
  } catch {
    return null;
  }
}

export function saveDAG(dag: SemanticDAG, projectRoot: string): void {
  const graphDir = getGraphDir(projectRoot);
  if (!fs.existsSync(graphDir)) {
    fs.mkdirSync(graphDir, { recursive: true });
  }

  const dagPath = getDagPath(projectRoot);
  fs.writeFileSync(dagPath, JSON.stringify(dag, null, 2), "utf-8");
}

export function ensureGitignoreEntry(projectRoot: string): void {
  // .adr-graph/ should be tracked (not ignored)
  // but we do want to ignore any local-only cache files
  const cacheDir = path.join(getGraphDir(projectRoot), ".cache");
  if (!fs.existsSync(cacheDir)) {
    fs.mkdirSync(cacheDir, { recursive: true });
  }

  const gitignorePath = path.join(getGraphDir(projectRoot), ".gitignore");
  if (!fs.existsSync(gitignorePath)) {
    fs.writeFileSync(gitignorePath, ".cache/\n", "utf-8");
  }
}
