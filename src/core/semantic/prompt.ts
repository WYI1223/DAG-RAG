/**
 * core/semantic/prompt.ts
 *
 * Builds the analysis prompt for one ADR and parses the LLM response.
 * Token budget target: ~4000 input tokens.
 */

import { GraphEdge, GraphNode, ModuleNode } from "../../types/graph.js";
import { ParsedAdr } from "../dag/adr-parser.js";

// ---- types for LLM output ----------------------------------

export interface InferredEdge {
  kind: "implements" | "affects" | "belongs_to";
  from: string;
  to: string;
  reason: string;
}

// ---- prompt construction ------------------------------------

const MAX_BODY_CHARS = 2000;
const MAX_MODULES = 80;

/**
 * Filter modules to the most relevant ones for a given ADR.
 * Strategy: path-keyword overlap between ADR body/title and module file paths.
 */
export function filterRelevantModules(
  adr: ParsedAdr,
  modules: ModuleNode[]
): ModuleNode[] {
  // exclude external packages — they can't implement/be affected by ADRs
  const internal = modules.filter((m) => m.language !== "external");

  // extract keywords from ADR title + body (directory-like segments)
  const text = `${adr.node.title} ${adr.body}`.toLowerCase();
  const keywords = [
    ...new Set(
      text.match(/[a-z][a-z0-9_-]{2,}/g)?.filter(
        (w) => !["the", "and", "for", "this", "that", "with", "from", "are", "was", "not", "but", "has", "had", "have", "been"].includes(w)
      ) ?? []
    ),
  ];

  // score each module by keyword overlap with its file path
  const scored = internal.map((m) => {
    const pathLower = m.filePath.toLowerCase();
    const score = keywords.reduce(
      (sum, kw) => sum + (pathLower.includes(kw) ? 1 : 0),
      0
    );
    return { mod: m, score };
  });

  // include all modules from frontmatter affects paths (always relevant)
  const affectsPaths = (adr.frontmatter.affects ?? []).map((p) =>
    p.replace(/\\/g, "/").toLowerCase()
  );
  for (const s of scored) {
    const rel = s.mod.filePath.replace(/\\/g, "/").toLowerCase();
    if (affectsPaths.some((a) => rel.includes(a))) {
      s.score += 10; // boost
    }
  }

  // sort by score descending, take top N
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, MAX_MODULES).map((s) => s.mod);
}

/** Compress a module to a single prompt line */
function moduleToLine(m: ModuleNode): string {
  const exports = m.exports.length > 0 ? m.exports.slice(0, 8).join(", ") : "(none)";
  return `- ${m.id} | ${m.label} | exports: ${exports}`;
}

export function buildAnalysisPrompt(
  adr: ParsedAdr,
  modules: ModuleNode[],
  existingEdges: GraphEdge[]
): string {
  const body =
    adr.body.length > MAX_BODY_CHARS
      ? adr.body.slice(0, MAX_BODY_CHARS) + "\n...(truncated)"
      : adr.body;

  const moduleLines = modules.map(moduleToLine).join("\n");

  const existingLines =
    existingEdges.length > 0
      ? existingEdges
          .map((e) => `- ${e.kind}: ${e.from} -> ${e.to} (${e.certainty})`)
          .join("\n")
      : "(none)";

  return `## Architecture Decision Record

ID: ${adr.node.id}
Title: ${adr.node.title}
Status: ${adr.node.status}

Body:
${body}

## Code Modules in This Project

${moduleLines}

## Existing Bindings (already known)

${existingLines}

## Task

Analyze this ADR and the code modules above. Identify semantic relationships that are NOT already in the existing bindings. Return a JSON array of objects:

[
  {
    "kind": "implements" | "affects",
    "from": "<source node id>",
    "to": "<target node id>",
    "reason": "<1-2 sentences: what evidence in the ADR text and module name/exports supports this relationship>"
  }
]

Rules:
- "implements": from=ADR id, to=Module id. This code directly implements this decision.
- "affects": from=ADR id, to=Module id. This decision constrains or influences this code.
- The "reason" must cite specific evidence: quote relevant ADR text and explain how it maps to the module.
- Only include relationships you are confident about. When in doubt, omit.
- Do NOT repeat existing bindings.
- If no new relationships are found, return an empty array: []`;
}

// ---- response parsing ---------------------------------------

export function parseAnalysisResponse(raw: string): InferredEdge[] {
  // strip markdown code fences if present
  let cleaned = raw.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```[a-z]*\n?/, "").replace(/\n?```$/, "");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return [];
  }

  if (!Array.isArray(parsed)) return [];

  const valid: InferredEdge[] = [];
  for (const item of parsed) {
    if (
      typeof item === "object" &&
      item !== null &&
      typeof item.kind === "string" &&
      typeof item.from === "string" &&
      typeof item.to === "string" &&
      typeof item.reason === "string" &&
      ["implements", "affects", "belongs_to"].includes(item.kind)
    ) {
      valid.push({ kind: item.kind, from: item.from, to: item.to, reason: item.reason });
    }
  }

  return valid;
}
