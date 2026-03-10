---
id: ADR-024
status: accepted
affects:
  - src/core/semantic/checker.ts
  - src/core/semantic/check-prompt.ts
  - src/core/semantic/code-summarizer.ts
---

# On-demand code reading via read_code tool (Phase 2)

## Context

ADR-023 introduced tool-use for structured output (submit_verdict), which eliminated JSON parsing failures. However, the code is still pre-loaded into the user message via the code summarizer (ADR-018). For large files like html-generator.ts (700+ lines), the summarizer collapses most code blocks to one-line signatures.

This causes false positives: the LLM sees `treemapG ... display: none` but the toggle logic and `d3.treemap()` call are in collapsed blocks. The LLM violates the "do not count collapsed blocks as evidence of absence" rule because it has no way to verify what's inside them.

The root cause is architectural: pre-loading forces a fixed code budget regardless of what the LLM actually needs to evaluate. A module with 7 ADR bindings may need different code sections for each ADR, but the summarizer picks blocks based on the first ADR's keywords only.

## Decision

Replace pre-loaded source code with an initial code overview + on-demand `read_code` tool.

### Initial code overview

The user message includes a **skeleton** of the module instead of summarized source:

- All import statements (always included)
- All export signatures
- Function/class/block signatures with line counts: `function computeDirLayout() — 100 lines`
- No function bodies

This is much smaller than the current summarized code and gives the LLM a map of what's available.

### read_code tool

```json
{
  "name": "read_code",
  "description": "Read the full source code of a specific function, class, or code block in the current module. Use the block name from the code overview.",
  "input_schema": {
    "type": "object",
    "required": ["block_name"],
    "properties": {
      "block_name": {
        "type": "string",
        "description": "The function/class/block name to read, e.g. 'computeDirLayout' or 'imports'"
      }
    }
  }
}
```

### Multi-turn flow

```
Turn 1 (user): code overview + ADR bodies + binding list
Turn 1 (LLM): calls read_code("computeDirLayout"), read_code("treemapToggle")
Turn 2 (user): returns full code for requested blocks
Turn 2 (LLM): calls submit_verdict("ADR-007", "aligned", "related", "...")
```

The LLM reads only the code blocks it needs to evaluate each binding. For small files that fit entirely in the overview, no read_code calls are needed.

### Implementation

Reuse existing `splitIntoBlocks` from code-summarizer.ts:

1. `buildCodeOverview(filePath)` — returns imports + block signatures (no bodies)
2. `readCodeBlock(filePath, blockName)` — finds block by name and returns full body
3. In checker.ts, the tool-use loop handles both `read_code` (returns code) and `submit_verdict` (records result)

### Small file optimization

If the full file is under 6000 chars, include it directly in the overview (no read_code needed). This avoids unnecessary tool-call round trips for small modules.

### What changes from ADR-023

- User message: code overview replaces full summarized code
- Tools: `read_code` added alongside `submit_verdict`
- Multi-turn: now expected to be 2+ turns (read then verdict) instead of 1
- Code summarizer: new `buildCodeOverview` and `readCodeBlock` exports

### What stays the same

- System prompt structure (ADR-023)
- submit_verdict tool (ADR-023)
- Module-centric grouping (ADR-022)
- Three-tier relevance (ADR-021)
- DAG mutation logic
- CLI display

## Consequences

- Positive: eliminates false positives from code truncation — LLM can always read the full implementation
- Positive: initial prompt is smaller (overview only), reducing base token cost
- Positive: LLM reads only relevant code per ADR, more efficient than pre-loading everything
- Positive: naturally handles large files — no budget tuning needed
- Negative: additional tool-call round trips increase latency (1-2 extra turns)
- Negative: total tokens may increase for small files where the overview + read_code costs more than direct inclusion
- Negative: more complex multi-turn orchestration in checker.ts
