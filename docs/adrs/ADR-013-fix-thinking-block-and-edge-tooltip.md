---
id: ADR-013
status: accepted
affects:
  - src/core/semantic/client.ts
  - src/core/viz/html-generator.ts
  - src/cli/index.ts
---

# Fix thinking-block extraction bug and add edge reason tooltip

## Context

Two issues were discovered during integration testing of the semantic LLM layer:

1. **Thinking-block bug**: When using models that return extended thinking (e.g. Claude with thinking enabled), the API response `content` array starts with a `{ type: "thinking" }` block followed by the actual `{ type: "text" }` block. The client read only `content[0]`, which was the thinking block, and fell back to `"[]"` — silently discarding the real LLM output. This manifested as 900+ output tokens consumed but an empty `[]` result for every ADR.

2. **No edge details in visualization**: The web visualization showed edges but provided no way to see their kind, certainty, or the LLM-inferred reason. Inferred edges were visually indistinguishable beyond a dashed stroke.

## Decision

### Fix content block extraction

`SemanticClient.analyze()` now uses `response.content.find(b => b.type === "text")` instead of `response.content[0]`. This correctly skips thinking blocks, tool-use blocks, or any future non-text block types.

### Edge tooltip on hover

The HTML visualization adds hover tooltips on edges:
- **Source → Target** labels as the title
- **Edge kind** (implements, affects, depends_on, etc.) and **certainty** (certain / inferred)
- **Reason** text for inferred edges (from LLM analysis)

Invisible 12px-wide hit-area lines sit behind each visible edge line for easier mouse targeting. Hit-area visibility stays in sync with the visible edges across all interaction modes (filters, node inspection, treemap).

### Verbose mode

`--verbose` flag on `init` and `scan` commands prints the full prompt sent to the LLM and the raw response text for each ADR, enabling debugging of empty or unexpected results.

### Legend and filter updates

- Added `affects` and `belongs_to` to edge filter checkboxes
- Added "inferred (LLM)" dashed-line legend entry
- Added "Hover edge for details" hint

## Consequences

- Positive: models with extended thinking now work correctly — the actual JSON response is extracted regardless of preceding content blocks
- Positive: users can inspect why an inferred edge exists directly in the visualization
- Positive: `--verbose` enables quick debugging of LLM integration without code changes
- Negative: hit-area lines double the number of SVG line elements (negligible for typical graph sizes)
