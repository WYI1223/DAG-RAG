/**
 * core/semantic/check-prompt.ts
 *
 * Builds the drift-check prompt for one ADR↔Module binding.
 * Unlike the analysis prompt (which only sends metadata), this sends
 * actual source code so the LLM can evaluate compliance.
 */

import * as fs from "fs";
import { GraphEdge, ModuleNode } from "../../types/graph.js";
import { ParsedAdr } from "../dag/adr-parser.js";

// ---- types for LLM output ----------------------------------

export interface DriftResult {
  status: "aligned" | "drifting" | "broken";
  misbound: boolean;
  reason: string;
}

// ---- prompt construction ------------------------------------

const MAX_ADR_CHARS = 3000;
const MAX_CODE_CHARS = 6000;

/** Read and truncate a source file */
function readSourceCode(filePath: string): string | null {
  try {
    const code = fs.readFileSync(filePath, "utf-8");
    if (code.length > MAX_CODE_CHARS) {
      return code.slice(0, MAX_CODE_CHARS) + "\n// ...(truncated)";
    }
    return code;
  } catch {
    return null;
  }
}

export function buildCheckPrompt(
  adr: ParsedAdr,
  mod: ModuleNode,
  bindingKind: string,
  relatedEdges: GraphEdge[]
): string {
  const body =
    adr.body.length > MAX_ADR_CHARS
      ? adr.body.slice(0, MAX_ADR_CHARS) + "\n...(truncated)"
      : adr.body;

  const code = readSourceCode(mod.filePath);
  const codeSection = code
    ? code
    : `(source file not found: ${mod.filePath})`;

  const edgeLines =
    relatedEdges.length > 0
      ? relatedEdges
          .map((e) => `- ${e.kind}: ${e.from} → ${e.to} (${e.certainty})`)
          .join("\n")
      : "(none)";

  return `## Architecture Decision Record

ID: ${adr.node.id}
Title: ${adr.node.title}
Status: ${adr.node.status}

Body:
${body}

## Module Under Review

ID: ${mod.id}
File: ${mod.filePath}
Binding: ${bindingKind}
Exports: ${mod.exports.length > 0 ? mod.exports.join(", ") : "(none)"}
Imports: ${mod.imports.length > 0 ? mod.imports.map(i => i.replace(/\.js$/, "")).join(", ") : "(none)"}

### Source Code

\`\`\`typescript
${codeSection}
\`\`\`

## Related Edges in the DAG

${edgeLines}

## Task

Evaluate whether this module's **actual source code** is consistent with the ADR decision above.

The binding type is "${bindingKind}":
- If "implements": the module's own code must DIRECTLY implement the core decision. "Directly" means the module itself uses the technology, pattern, or approach described in the ADR — not that it imports from or delegates to another module that does. Delegation is NOT implementation.
- If "affects": the module's behavior or API contract is constrained by the decision.

Return a single JSON object (no markdown fences, no preamble):

{
  "status": "aligned" | "drifting" | "broken",
  "misbound": true | false,
  "reason": "<2-3 sentences: cite specific code and ADR text as evidence>"
}

Definitions:
- "aligned": The code directly implements or respects the decision. No divergence detected.
- "drifting": The intent is recognizable, but specific details have diverged. Something has shifted or is incomplete.
- "broken": The code contradicts or ignores the decision. The binding is no longer valid.
- "misbound": Set to true if the module has NO meaningful relationship to the ADR's core decision — it neither implements the technology/pattern described nor is constrained by it. This means the binding itself is likely incorrect and should be removed, rather than the code needing to change. When misbound is true, set status to "broken".

Rules:
- Base your evaluation ONLY on the source code shown above and the ADR text. Do not speculate about code you cannot see.
- If the ADR describes using a specific technology (e.g. a library, API, framework) and the module does NOT import or use that technology anywhere in its source code, it does NOT "implement" this ADR. Do not rationalize indirect relationships through delegation.
- Apply this standard consistently: if two modules have the same relationship to the ADR (neither directly uses the technology), they must receive the same status.
- If the source file could not be read, return "drifting" with reason explaining the file is inaccessible.
- Be precise: quote specific function names, imports, or code patterns as evidence.`;
}

// ---- response parsing ---------------------------------------

export function parseCheckResponse(raw: string): DriftResult | null {
  let cleaned = raw.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```[a-z]*\n?/, "").replace(/\n?```$/, "");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return null;
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
    return {
      status: (parsed as any).status,
      misbound: (parsed as any).misbound === true,
      reason: (parsed as any).reason,
    };
  }

  return null;
}
