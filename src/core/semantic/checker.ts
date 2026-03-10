/**
 * core/semantic/checker.ts
 *
 * Orchestrates drift detection with tool-use based checking.
 * ADR-022: code-centric grouping by module.
 * ADR-023: structured output via submit_verdict tool.
 * ADR-024: on-demand code reading via read_code tool.
 */

import {
  SemanticDAG,
  ModuleNode,
  AdrNode,
  SemanticBinding,
} from "../../types/graph.js";
import { ParsedAdr } from "../dag/adr-parser.js";
import { SemanticClient, ToolCall } from "./client.js";
import { readCodeBlock } from "./code-summarizer.js";
import {
  buildCheckUserMessage,
  parseToolCallResults,
  CHECK_SYSTEM_PROMPT,
  SUBMIT_VERDICT_TOOL,
  READ_CODE_TOOL,
  AdrBinding,
  Relevance,
} from "./check-prompt.js";

// ---- types --------------------------------------------------

export interface CheckResult {
  bindingsChecked: number;
  aligned: number;
  drifting: number;
  broken: number;
  unrelated: number;
  possiblyRelated: number;
  skippedPreviouslyResolved: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheReadTokens: number;
  totalCacheCreationTokens: number;
  totalDurationMs: number;
  bindings: SemanticBinding[];
  /** Edge IDs that should be removed from DAG (unrelated) */
  prunedEdgeIds: string[];
  /** Edge IDs marked as possibly_related (skip by default next time) */
  possiblyRelatedEdgeIds: string[];
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
  /** Filter: only check bindings for these module ids (from --changed) */
  filterModuleIds?: Set<string>;
  /** Check all bindings including previously possibly_related ones */
  checkAll?: boolean;
}

// ---- helpers ------------------------------------------------

interface Binding {
  adr: ParsedAdr;
  mod: ModuleNode;
  kind: string;
  edgeId: string;
}

interface ModuleGroup {
  mod: ModuleNode;
  bindings: { adr: ParsedAdr; kind: string; edgeId: string }[];
}

function collectBindings(
  dag: SemanticDAG,
  adrs: ParsedAdr[],
  opts: CheckOptions
): Binding[] {
  const adrMap = new Map(adrs.map((a) => [a.node.id, a]));
  const bindings: Binding[] = [];

  for (const edge of Object.values(dag.edges)) {
    if (edge.kind !== "implements" && edge.kind !== "affects") continue;

    const fromNode = dag.nodes[edge.from];
    const toNode = dag.nodes[edge.to];
    if (!fromNode || !toNode) continue;
    if (fromNode.kind !== "adr" || toNode.kind !== "module") continue;
    if ((toNode as ModuleNode).language === "external") continue;

    if (opts.filterAdr && fromNode.id !== opts.filterAdr) continue;
    if (opts.filterModule && toNode.id !== opts.filterModule) continue;
    if (opts.filterModuleIds && !opts.filterModuleIds.has(toNode.id)) continue;

    const adr = adrMap.get(fromNode.id);
    if (!adr) continue;

    bindings.push({
      adr,
      mod: toNode as ModuleNode,
      kind: edge.kind,
      edgeId: edge.id,
    });
  }

  return bindings;
}

function groupByModule(bindings: Binding[]): ModuleGroup[] {
  const map = new Map<string, ModuleGroup>();

  for (const b of bindings) {
    let group = map.get(b.mod.id);
    if (!group) {
      group = { mod: b.mod, bindings: [] };
      map.set(b.mod.id, group);
    }
    group.bindings.push({ adr: b.adr, kind: b.kind, edgeId: b.edgeId });
  }

  for (const group of map.values()) {
    group.bindings.sort((a, b) => a.adr.node.id.localeCompare(b.adr.node.id));
  }

  return [...map.values()];
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
    unrelated: 0,
    possiblyRelated: 0,
    skippedPreviouslyResolved: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCacheReadTokens: 0,
    totalCacheCreationTokens: 0,
    totalDurationMs: 0,
    bindings: [],
    prunedEdgeIds: [],
    possiblyRelatedEdgeIds: [],
    errors: [],
  };

  const allBindings = collectBindings(dag, adrs, opts);

  const bindings = opts.checkAll
    ? allBindings
    : allBindings.filter((b) => {
        const edge = dag.edges[b.edgeId];
        return edge?.metadata?.relevance !== "possibly_related";
      });
  result.skippedPreviouslyResolved = allBindings.length - bindings.length;

  const totalBindings = bindings.length;
  const groups = groupByModule(bindings);

  for (const group of groups) {
    const adrBindings: AdrBinding[] = group.bindings.map((b) => ({
      adr: b.adr,
      kind: b.kind,
    }));
    const adrIds = group.bindings.map((b) => b.adr.node.id);

    onProgress?.({
      current: result.bindingsChecked + 1,
      total: totalBindings,
      adrId: adrIds.join(", "),
      moduleId: group.mod.id,
      status: "checking",
      tokensPerSec:
        result.totalDurationMs > 0
          ? Math.round(
              (result.totalOutputTokens / result.totalDurationMs) * 1000
            )
          : undefined,
    });

    try {
      const { text: userMessage, codeComplete } = buildCheckUserMessage(group.mod, adrBindings);

      // tools: always submit_verdict; add read_code only if code is not complete
      const tools = codeComplete
        ? [SUBMIT_VERDICT_TOOL]
        : [SUBMIT_VERDICT_TOOL, READ_CODE_TOOL];

      // tool handler: resolve read_code calls with actual code
      const filePath = group.mod.filePath;
      const toolHandler = (call: ToolCall): string => {
        if (call.name === "read_code") {
          const blockName = String(call.input.block_name ?? "");
          const code = readCodeBlock(filePath, blockName);
          vlog(`    read_code("${blockName}") → ${code ? code.length + " chars" : "not found"}`);
          return code ?? `Block "${blockName}" not found in this module.`;
        }
        return "Recorded.";
      };

      vlog(
        `\n--- [${group.mod.id}] (${group.bindings.length} ADRs: ${adrIds.join(", ")}, msg ${userMessage.length} chars${codeComplete ? "" : ", overview mode"}) ---`
      );

      const response = await client.analyzeWithTools({
        system: CHECK_SYSTEM_PROMPT,
        userMessage,
        tools,
        toolHandler,
      });

      const cacheTag = response.cacheReadTokens > 0 ? `  cache read: ${response.cacheReadTokens}` : "";
      vlog(
        `  tokens: ${response.inputTokens} in / ${response.outputTokens} out, ${response.durationMs}ms${cacheTag}`
      );
      if (response.thinking) {
        vlog(`  thinking: ${response.thinking}`);
      }
      const verdicts = response.toolCalls.filter((tc) => tc.name === "submit_verdict");
      const reads = response.toolCalls.filter((tc) => tc.name === "read_code");
      vlog(`  tool_calls: ${verdicts.length} verdicts, ${reads.length} code reads`);
      for (const tc of verdicts) {
        vlog(`    ${tc.name}(${JSON.stringify(tc.input)})`);
      }

      result.totalInputTokens += response.inputTokens;
      result.totalOutputTokens += response.outputTokens;
      result.totalCacheReadTokens += response.cacheReadTokens;
      result.totalCacheCreationTokens += response.cacheCreationTokens;
      result.totalDurationMs += response.durationMs;

      const driftResults = parseToolCallResults(response.toolCalls);
      const resultMap = new Map(driftResults.map((d) => [d.adrId, d]));

      for (const binding of group.bindings) {
        result.bindingsChecked++;
        const drift = resultMap.get(binding.adr.node.id);

        if (drift) {
          const relevanceTag =
            drift.relevance === "unrelated"
              ? "[UNRELATED] "
              : drift.relevance === "possibly_related"
                ? "[POSSIBLY_RELATED] "
                : "";

          const sb: SemanticBinding = {
            adrId: binding.adr.node.id,
            moduleId: group.mod.id,
            status: drift.status,
            certainty: "inferred",
            reason: relevanceTag + drift.reason,
            checkedAt: new Date().toISOString(),
          };
          result.bindings.push(sb);

          if (drift.relevance === "unrelated") {
            result.unrelated++;
            result.prunedEdgeIds.push(binding.edgeId);
          } else if (drift.relevance === "possibly_related") {
            result.possiblyRelated++;
            result.possiblyRelatedEdgeIds.push(binding.edgeId);
          }

          if (drift.relevance === "related") {
            if (drift.status === "aligned") result.aligned++;
            else if (drift.status === "drifting") result.drifting++;
            else if (drift.status === "broken") result.broken++;
          }
        } else {
          result.errors.push(
            `${binding.adr.node.id} → ${group.mod.id}: no submit_verdict call returned by LLM`
          );
        }
      }

      onProgress?.({
        current: result.bindingsChecked,
        total: totalBindings,
        adrId: adrIds.join(", "),
        moduleId: group.mod.id,
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
      for (const binding of group.bindings) {
        result.bindingsChecked++;
        result.errors.push(
          `${binding.adr.node.id} → ${group.mod.id}: ${msg}`
        );
      }

      onProgress?.({
        current: result.bindingsChecked,
        total: totalBindings,
        adrId: adrIds.join(", "),
        moduleId: group.mod.id,
        status: "error",
      });
    }
  }

  return result;
}
