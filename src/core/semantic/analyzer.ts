/**
 * core/semantic/analyzer.ts
 *
 * Orchestrates semantic analysis: iterates over ADRs, calls LLM, merges
 * inferred edges into the DAG.
 */

import { SemanticDAG, GraphEdge, ModuleNode } from "../../types/graph.js";
import { ParsedAdr } from "../dag/adr-parser.js";
import { SemanticClient } from "./client.js";
import {
  buildAnalysisPrompt,
  filterRelevantModules,
  parseAnalysisResponse,
} from "./prompt.js";

export interface SemanticAnalysisResult {
  adrCount: number;
  edgesAdded: number;
  edgesSkipped: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalDurationMs: number;
  errors: string[];
}

export interface AnalysisProgress {
  current: number;
  total: number;
  adrId: string;
  status: "analyzing" | "done" | "error";
  edgesAdded: number;
  /** output tokens / second for the latest call */
  tokensPerSec?: number;
}

function edgeId(from: string, to: string, kind: string): string {
  return `${kind}:${from}→${to}`;
}

export interface AnalyzeOptions {
  onProgress?: (progress: AnalysisProgress) => void;
  verbose?: boolean;
  /** writable stream for verbose output (defaults to process.stdout) */
  verboseStream?: { write(s: string): void };
}

export async function analyzeSemantics(
  dag: SemanticDAG,
  adrs: ParsedAdr[],
  client: SemanticClient,
  onProgressOrOpts?: ((progress: AnalysisProgress) => void) | AnalyzeOptions
): Promise<SemanticAnalysisResult> {
  const opts: AnalyzeOptions =
    typeof onProgressOrOpts === "function"
      ? { onProgress: onProgressOrOpts }
      : onProgressOrOpts ?? {};
  const { onProgress, verbose } = opts;
  const log = opts.verboseStream ?? process.stdout;
  const vlog = (s: string) => { if (verbose) log.write(s + "\n"); };
  const result: SemanticAnalysisResult = {
    adrCount: 0,
    edgesAdded: 0,
    edgesSkipped: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalDurationMs: 0,
    errors: [],
  };

  // collect all internal modules once
  const allModules = Object.values(dag.nodes).filter(
    (n): n is ModuleNode => n.kind === "module"
  );

  // only analyze active ADRs
  const activeAdrs = adrs.filter(
    (a) => a.node.status !== "deprecated" && a.node.status !== "superseded"
  );

  for (const adr of activeAdrs) {
    result.adrCount++;
    const runningTps = result.totalDurationMs > 0
      ? Math.round((result.totalOutputTokens / result.totalDurationMs) * 1000)
      : undefined;
    onProgress?.({
      current: result.adrCount,
      total: activeAdrs.length,
      adrId: adr.node.id,
      status: "analyzing",
      edgesAdded: result.edgesAdded,
      tokensPerSec: runningTps,
    });

    try {
      // filter to relevant modules
      const modules = filterRelevantModules(adr, allModules);
      if (modules.length === 0) continue;

      // gather existing edges for this ADR
      const existingEdges = Object.values(dag.edges).filter(
        (e) => e.from === adr.node.id || e.to === adr.node.id
      );

      const prompt = buildAnalysisPrompt(adr, modules, existingEdges);
      vlog(`\n--- [${adr.node.id}] prompt (${prompt.length} chars) ---`);
      vlog(prompt);
      const response = await client.analyze(prompt);
      const truncLabel = response.truncated ? " TRUNCATED" : "";
      if (response.thinking) {
        vlog(`\n--- [${adr.node.id}] thinking ---`);
        vlog(response.thinking);
      }
      vlog(`\n--- [${adr.node.id}] response (${response.inputTokens} in / ${response.outputTokens} out, ${response.durationMs}ms)${truncLabel} ---`);
      vlog(response.text);

      if (response.truncated) {
        result.errors.push(`${adr.node.id}: response truncated (hit max_tokens) — output may be incomplete`);
      }
      const inferred = parseAnalysisResponse(response.text);

      result.totalInputTokens += response.inputTokens;
      result.totalOutputTokens += response.outputTokens;
      result.totalDurationMs += response.durationMs;

      // running average tok/s across all calls so far
      const tokensPerSec =
        result.totalDurationMs > 0
          ? Math.round((result.totalOutputTokens / result.totalDurationMs) * 1000)
          : undefined;

      for (const edge of inferred) {
        const eid = edgeId(edge.from, edge.to, edge.kind);

        // skip if edge already exists (certain or previously inferred)
        if (dag.edges[eid]) {
          result.edgesSkipped++;
          continue;
        }

        // validate that both nodes exist
        if (!dag.nodes[edge.from] || !dag.nodes[edge.to]) {
          result.edgesSkipped++;
          continue;
        }

        dag.edges[eid] = {
          id: eid,
          from: edge.from,
          to: edge.to,
          kind: edge.kind,
          certainty: "inferred",
          metadata: { reason: edge.reason },
        };
        result.edgesAdded++;
      }
      onProgress?.({
        current: result.adrCount,
        total: activeAdrs.length,
        adrId: adr.node.id,
        status: "done",
        edgesAdded: result.edgesAdded,
        tokensPerSec,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      result.errors.push(`${adr.node.id}: ${msg}`);
      onProgress?.({
        current: result.adrCount,
        total: activeAdrs.length,
        adrId: adr.node.id,
        status: "error",
        edgesAdded: result.edgesAdded,
      });
    }
  }

  return result;
}
