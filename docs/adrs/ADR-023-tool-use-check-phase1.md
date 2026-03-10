---
id: ADR-023
status: accepted
affects:
  - src/core/semantic/client.ts
  - src/core/semantic/checker.ts
  - src/core/semantic/check-prompt.ts
---

# Tool-use based drift check (Phase 1)

## Context

ADR-022 introduced code-centric batch checking, which dramatically reduced tokens (67%) and eliminated false-positive drift from ADR evolution. However, the approach still has issues:

1. **LLM confuses context with task**: Related edges (provided as context) are sometimes mistakenly evaluated as bindings, causing missing results (e.g., adr-parser.ts returned `[]`).
2. **JSON array parsing fragility**: The LLM must output a well-formed JSON array with exactly N entries. Any formatting deviation (markdown fences, missing entries, extra text) causes parse failures.
3. **Flat prompt structure**: Instructions, data, and rules are interleaved in a single flat prompt. No clear hierarchy of "what to do" vs "data to use" vs "how to judge".

Tool-use solves all three: the LLM calls a `submit_verdict` tool once per binding, producing structured output that never needs JSON parsing. The system prompt is cleanly separated from data.

## Decision

### Phase 1: Structured output via tool-use

Replace JSON array output with a `submit_verdict` tool. ADR bodies remain in the prompt (Phase 2 will make them lazy-loaded).

### SemanticClient interface change

Add a new method to `SemanticClient`:

```typescript
analyzeWithTools(opts: {
  system: string;
  userMessage: string;
  tools: ToolDefinition[];
}): Promise<ToolUseResult>;
```

Where `ToolUseResult` contains the list of tool calls made by the LLM, plus token/timing metrics.

### Tool definition

One tool: `submit_verdict`

```json
{
  "name": "submit_verdict",
  "description": "Submit your evaluation for one ADR↔Module binding.",
  "input_schema": {
    "type": "object",
    "required": ["adr_id", "status", "relevance", "reason"],
    "properties": {
      "adr_id": { "type": "string", "description": "The ADR ID, e.g. ADR-009" },
      "status": { "type": "string", "enum": ["aligned", "drifting", "broken"] },
      "relevance": { "type": "string", "enum": ["related", "possibly_related", "unrelated"] },
      "reason": { "type": "string", "description": "2-3 sentences citing specific code and ADR text as evidence" }
    }
  }
}
```

### Prompt restructure

- **System prompt**: Fixed rules, status/relevance definitions, judgment criteria. Never changes per call.
- **User message**: Module code + ADR bodies + binding list. Changes per module group.
- No "Related Edges" section — removes the source of confusion.

### Multi-turn loop

The checker runs a loop:

1. Send system + user message + tools
2. Receive response — may contain `tool_use` blocks
3. For each `tool_use` block, extract the verdict and record it
4. Send `tool_result` responses back (acknowledge receipt)
5. Continue until LLM sends `end_turn` stop reason

In practice, for Phase 1 the LLM should emit all `submit_verdict` calls in a single response (no multi-turn needed for most cases). The loop handles edge cases where the model splits across turns.

### What stays the same

- Code-centric grouping by module (ADR-022) — unchanged
- Three-tier relevance classification (ADR-021) — unchanged
- DAG mutation logic — unchanged
- CLI display — unchanged
- `analyze()` method on SemanticClient — unchanged, still used by `analyzer.ts`

## Consequences

- Positive: eliminates JSON parsing failures — tool calls are always structured
- Positive: clean hierarchy — system prompt for rules, user message for data
- Positive: removes "Related Edges" section that caused LLM confusion
- Positive: each verdict is an individual tool call — no risk of missing entries in an array
- Negative: slightly more complex client code (tool-use API)
- Negative: tool-use may increase output tokens slightly (tool call overhead)
- Negative: some providers may not support tool-use (compatible API) — fallback to current JSON mode needed
