/**
 * core/semantic/checker.ts
 *
 * Orchestrates drift detection: iterates over ADR↔Module bindings,
 * sends actual source code to the LLM, and collects binding statuses.
 */

import {
  SemanticDAG,
  GraphEdge,
  ModuleNode,
  AdrNode,
  SemanticBinding,
} from "../../types/graph.js";
import { ParsedAdr } from "../dag/adr-parser.js";
import { SemanticClient } from "./client.js";
import { buildCheckPrompt, parseCheckResponse } from "./check-prompt.js";

// ---- types --------------------------------------------------

export interface CheckResult {
  bindingsChecked: number;
  aligned: number;
  drifting: number;
  broken: number;
  misbound: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalDurationMs: number;
  bindings: SemanticBinding[];
  errors: string[];
}

export interface CheckProgress {
  current: number;
  total: number;
  adrId: string;
  moduleId: string;
  status: "checking" | "done" | "error";
  tokensPerSec?: number;
}

export interface CheckOptions {
  onProgress?: (progress: CheckProgress) => void;
  verbose?: boolean;
  verboseStream?: { write(s: string): void };
  /** Filter: only check bindings for this ADR id */
  filterAdr?: string;
  /** Filter: only check bindings for this module id */
  filterModule?: string;
}

// ---- helpers ------------------------------------------------

interface Binding {
  adr: ParsedAdr;
  mod: ModuleNode;
  kind: string; // edge kind: "implements" | "affects"
}

/** Collect all ADR→Module bindings from edges in the DAG */
function collectBindings(
  dag: SemanticDAG,
  adrs: ParsedAdr[],
  opts: CheckOptions
): Binding[] {
  const adrMap = new Map(adrs.map((a) => [a.node.id, a]));
  const bindings: Binding[] = [];

  for (const edge of Object.values(dag.edges)) {
    // only ADR→Module edges
    if (edge.kind !== "implements" && edge.kind !== "affects") continue;

    const fromNode = dag.nodes[edge.from];
    const toNode = dag.nodes[edge.to];
    if (!fromNode || !toNode) continue;
    if (fromNode.kind !== "adr" || toNode.kind !== "module") continue;

    // skip external packages
    if ((toNode as ModuleNode).language === "external") continue;

    // apply filters
    if (opts.filterAdr && fromNode.id !== opts.filterAdr) continue;
    if (opts.filterModule && toNode.id !== opts.filterModule) continue;

    const adr = adrMap.get(fromNode.id);
    if (!adr) continue;

    bindings.push({
      adr,
      mod: toNode as ModuleNode,
      kind: edge.kind,
    });
  }

  return bindings;
}

// ---- main ---------------------------------------------------

export async function checkDrift(
  dag: SemanticDAG,
  adrs: ParsedAdr[],
  client: SemanticClient,
  opts: CheckOptions = {}
): Promise<CheckResult> {
  const { onProgress, verbose } = opts;
  const log = opts.verboseStream ?? process.stdout;
  const vlog = (s: string) => {
    if (verbose) log.write(s + "\n");
  };

  const result: CheckResult = {
    bindingsChecked: 0,
    aligned: 0,
    drifting: 0,
    broken: 0,
    misbound: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalDurationMs: 0,
    bindings: [],
    errors: [],
  };

  const bindings = collectBindings(dag, adrs, opts);

  for (const binding of bindings) {
    result.bindingsChecked++;

    onProgress?.({
      current: result.bindingsChecked,
      total: bindings.length,
      adrId: binding.adr.node.id,
      moduleId: binding.mod.id,
      status: "checking",
      tokensPerSec:
        result.totalDurationMs > 0
          ? Math.round(
              (result.totalOutputTokens / result.totalDurationMs) * 1000
            )
          : undefined,
    });

    try {
      // gather edges related to this ADR or module for context
      const relatedEdges = Object.values(dag.edges).filter(
        (e) =>
          e.from === binding.adr.node.id ||
          e.to === binding.mod.id ||
          e.from === binding.mod.id
      );

      const prompt = buildCheckPrompt(
        binding.adr,
        binding.mod,
        binding.kind,
        relatedEdges
      );

      vlog(
        `\n--- [${binding.adr.node.id} → ${binding.mod.id}] prompt (${prompt.length} chars) ---`
      );
      vlog(prompt);

      const response = await client.analyze(prompt);

      vlog(
        `\n--- [${binding.adr.node.id} → ${binding.mod.id}] response (${response.inputTokens} in / ${response.outputTokens} out, ${response.durationMs}ms) ---`
      );
      if (response.thinking) {
        vlog(`thinking: ${response.thinking}`);
      }
      vlog(response.text);

      result.totalInputTokens += response.inputTokens;
      result.totalOutputTokens += response.outputTokens;
      result.totalDurationMs += response.durationMs;

      const drift = parseCheckResponse(response.text);

      if (drift) {
        const reason = drift.misbound
          ? `[MISBOUND] ${drift.reason}`
          : drift.reason;
        const sb: SemanticBinding = {
          adrId: binding.adr.node.id,
          moduleId: binding.mod.id,
          status: drift.status,
          certainty: "inferred",
          reason,
          checkedAt: new Date().toISOString(),
        };
        result.bindings.push(sb);

        if (drift.status === "aligned") result.aligned++;
        else if (drift.status === "drifting") result.drifting++;
        else if (drift.status === "broken") result.broken++;
        if (drift.misbound) result.misbound++;
      } else {
        result.errors.push(
          `${binding.adr.node.id} → ${binding.mod.id}: failed to parse LLM response`
        );
      }

      onProgress?.({
        current: result.bindingsChecked,
        total: bindings.length,
        adrId: binding.adr.node.id,
        moduleId: binding.mod.id,
        status: "done",
        tokensPerSec:
          result.totalDurationMs > 0
            ? Math.round(
                (result.totalOutputTokens / result.totalDurationMs) * 1000
              )
            : undefined,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      result.errors.push(
        `${binding.adr.node.id} → ${binding.mod.id}: ${msg}`
      );

      onProgress?.({
        current: result.bindingsChecked,
        total: bindings.length,
        adrId: binding.adr.node.id,
        moduleId: binding.mod.id,
        status: "error",
      });
    }
  }

  return result;
}
