/**
 * core/semantic/check-prompt.ts
 *
 * Builds the drift-check prompt components for tool-use based checking.
 * ADR-023: structured output via submit_verdict tool.
 * ADR-024: on-demand code reading via read_code tool.
 */

import { ModuleNode, Relevance } from "../../types/graph.js";
import { ParsedAdr } from "../dag/adr-parser.js";
import { buildCodeOverview } from "./code-summarizer.js";
import { ToolDefinition, ToolCall } from "./client.js";

export type { Relevance };

// ---- types for check output --------------------------------

export interface DriftResult {
  adrId: string;
  status: "aligned" | "drifting" | "broken";
  relevance: Relevance;
  reason: string;
}

// ---- tool definitions ---------------------------------------

export const SUBMIT_VERDICT_TOOL: ToolDefinition = {
  name: "submit_verdict",
  description: "Submit your evaluation for one ADR↔Module binding. You MUST call this tool exactly once for each binding listed in the user message.",
  input_schema: {
    type: "object",
    required: ["adr_id", "status", "relevance", "reason"],
    properties: {
      adr_id: { type: "string", description: "The ADR ID, e.g. ADR-009" },
      status: {
        type: "string",
        enum: ["aligned", "drifting", "broken"],
        description: "aligned = code matches decision; drifting = intent recognizable but details diverged; broken = code contradicts decision",
      },
      relevance: {
        type: "string",
        enum: ["related", "possibly_related", "unrelated"],
        description: "related = direct relationship; possibly_related = indirect/tangential; unrelated = no meaningful relationship, binding should be removed",
      },
      reason: {
        type: "string",
        description: "2-3 sentences citing specific code (function names, imports) and ADR text as evidence",
      },
    },
  },
};

export const READ_CODE_TOOL: ToolDefinition = {
  name: "read_code",
  description: "Read the full source code of a specific function, class, or code block in the current module. Use a block name from the code overview (e.g. a function name, class name, or section label). Use 'imports' to read the import section.",
  input_schema: {
    type: "object",
    required: ["block_name"],
    properties: {
      block_name: {
        type: "string",
        description: "The function/class/block name to read, e.g. 'computeDirLayout', 'buildClient', or 'imports'",
      },
    },
  },
};

// ---- system prompt (fixed) ----------------------------------

export const CHECK_SYSTEM_PROMPT = `You are an architecture compliance checker. You evaluate whether a source code module is consistent with Architecture Decision Records (ADRs).

## Workflow
1. Review the code overview and ADR descriptions provided.
2. If the code overview is complete (small file), you have all the code — proceed to evaluate.
3. If the code overview shows collapsed blocks (e.g. "computeDirLayout — 100 lines"), use the read_code tool to read any blocks you need to inspect before making a judgment.
4. Call submit_verdict once for each binding.

IMPORTANT: Do NOT judge a binding as "drifting" or "broken" based on code you haven't read. If a relevant function is collapsed in the overview, read it first using read_code before evaluating.

## Binding types
- "implements": the module's own code must DIRECTLY implement the core decision. "Directly" means the module itself uses the technology, pattern, or approach — not that it delegates to another module. Delegation is NOT implementation.
- "affects": the module's behavior or API contract is constrained by the decision.

## ADR evolution
ADRs are listed chronologically. Later ADRs may extend, modify, or supersede earlier ones. If the code diverges from an earlier ADR but aligns with a later ADR that explicitly changes that aspect, evaluate the earlier ADR as "aligned" (intentional evolution), not "drifting".

## Rules
- Base your evaluation ONLY on the source code and ADR text provided. Do not speculate about code you cannot see.
- If the ADR describes using a specific technology and the module does NOT import or use it, it does NOT "implement" this ADR. Do not rationalize indirect relationships through delegation.
- If the source file could not be read, return "drifting" with reason explaining the file is inaccessible.
- When relevance is "unrelated", set status to "broken".
- When relevance is "possibly_related", evaluate status as best you can but note the weak relationship.
- Be precise: quote specific function names, imports, or code patterns as evidence.`;

// ---- user message construction ------------------------------

const TOTAL_ADR_BUDGET = 20000;

export interface AdrBinding {
  adr: ParsedAdr;
  kind: string; // "implements" | "affects"
}

/**
 * Build the user message for one module + all its governing ADRs.
 * Uses code overview (ADR-024) instead of full summarized code.
 */
export function buildCheckUserMessage(
  mod: ModuleNode,
  adrBindings: AdrBinding[]
): { text: string; codeComplete: boolean } {
  const overview = buildCodeOverview(mod.filePath);
  const codeSection = overview?.text ?? `(source file not found: ${mod.filePath})`;
  const codeComplete = overview?.isComplete ?? false;

  const codeNote = codeComplete
    ? ""
    : "\n\nNote: This is a code overview with collapsed blocks. Use the read_code tool to inspect any block before judging it.";

  const perAdrBudget = Math.floor(TOTAL_ADR_BUDGET / adrBindings.length);
  const adrSections = adrBindings
    .map(({ adr, kind }) => {
      const body =
        adr.body.length > perAdrBudget
          ? adr.body.slice(0, perAdrBudget) + "\n...(truncated)"
          : adr.body;
      return `### ${adr.node.id}: ${adr.node.title} [binding: ${kind}]

Status: ${adr.node.status}

${body}`;
    })
    .join("\n\n---\n\n");

  const bindingList = adrBindings
    .map(({ adr, kind }) => `- ${adr.node.id} (${kind})`)
    .join("\n");

  const text = `## Module Under Review

ID: ${mod.id}
File: ${mod.filePath}
Exports: ${mod.exports.length > 0 ? mod.exports.join(", ") : "(none)"}
Imports: ${mod.imports.length > 0 ? mod.imports.map(i => i.replace(/\.js$/, "")).join(", ") : "(none)"}

### Source Code${codeComplete ? "" : " (overview)"}

\`\`\`typescript
${codeSection}
\`\`\`${codeNote}

## Governing ADRs (chronological order)

${adrSections}

## Bindings to Evaluate

Call submit_verdict once for each binding below (${adrBindings.length} total):

${bindingList}`;

  return { text, codeComplete };
}

// ---- parse tool calls into DriftResults ---------------------

const VALID_STATUS = new Set(["aligned", "drifting", "broken"]);
const VALID_RELEVANCE = new Set(["related", "possibly_related", "unrelated"]);

/** Convert tool calls from LLM response into DriftResults */
export function parseToolCallResults(toolCalls: ToolCall[]): DriftResult[] {
  const results: DriftResult[] = [];
  for (const call of toolCalls) {
    if (call.name !== "submit_verdict") continue;
    const input = call.input;
    if (
      typeof input.adr_id !== "string" ||
      typeof input.status !== "string" ||
      typeof input.reason !== "string" ||
      !VALID_STATUS.has(input.status)
    ) {
      continue;
    }

    let relevance: Relevance = "related";
    if (typeof input.relevance === "string" && VALID_RELEVANCE.has(input.relevance)) {
      relevance = input.relevance as Relevance;
    }

    results.push({
      adrId: input.adr_id,
      status: input.status as DriftResult["status"],
      relevance,
      reason: input.reason,
    });
  }
  return results;
}

// ---- legacy JSON parsing (kept for tests) -------------------

export function parseCheckResponse(raw: string): (DriftResult & { adrId?: string }) | null {
  let cleaned = raw.trim();
  const fenceMatch = cleaned.match(/^```[a-z]*\s*\n([\s\S]*?)\n\s*```$/);
  if (fenceMatch) {
    cleaned = fenceMatch[1].trim();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return null;
  }

  if (Array.isArray(parsed) && parsed.length === 1) {
    parsed = parsed[0];
  }

  if (
    typeof parsed === "object" &&
    parsed !== null &&
    "status" in parsed &&
    "reason" in parsed &&
    typeof (parsed as any).status === "string" &&
    typeof (parsed as any).reason === "string" &&
    ["aligned", "drifting", "broken"].includes((parsed as any).status)
  ) {
    let relevance: Relevance = "related";
    const raw_rel = (parsed as any).relevance;
    if (typeof raw_rel === "string" && VALID_RELEVANCE.has(raw_rel)) {
      relevance = raw_rel as Relevance;
    } else if ((parsed as any).misbound === true) {
      relevance = "unrelated";
    }

    return {
      adrId: (parsed as any).adrId ?? "",
      status: (parsed as any).status,
      relevance,
      reason: (parsed as any).reason,
    };
  }

  return null;
}
