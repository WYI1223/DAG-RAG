---
id: ADR-018
status: accepted
affects:
  - src/core/semantic/code-summarizer.ts
  - src/core/semantic/check-prompt.ts
---

# ADR-aware code summarization for drift checking

## Context

ADR-017 introduced `adr-graph check` with a fixed token budget (`MAX_CODE_CHARS = 6000`). When a module exceeds that limit, the file is truncated from the end — losing whatever code appears later in the file.

This causes systematic false judgments:
- **cli/index.ts** (560 lines): the `impact` and `check` commands appear after the truncation point, so the LLM reports them as missing
- **html-generator.ts** (621 lines): D3.js visualization logic lives inside template literal strings that are truncated, so the LLM cannot verify treemap, hull, or interaction implementations
- In the v1 full run, **6 out of 52 bindings** were misjudged due to truncation (12%), and 1 binding failed to parse entirely

The core insight: not all code in a file is equally relevant to a given ADR. When checking ADR-003 (impact analysis) against `cli/index.ts`, only the `impact` command block matters — the `init`, `scan`, and `viz` blocks are irrelevant noise.

## Decision

Replace blind truncation with **ADR-aware code summarization**: extract keywords from the ADR, split the source into logical blocks, and selectively expand only the blocks relevant to the ADR being checked.

**Three-stage pipeline:**

1. **Keyword extraction** from ADR title and body:
   - Title words (filtered by stop-word list, minimum 3 chars)
   - Backtick-wrapped terms (e.g., `d3.treemap()`, `analyzeImpact`)
   - Double-quoted identifiers (e.g., `"typescript"`)

2. **Code block splitting** at indent-0 boundaries:
   - Imports section (always included, detected across JSDoc/comment gaps)
   - Top-level declarations: `function`, `class`, `const`, `interface`, `type`, `enum`
   - Section comment markers: `// ---- name ----`
   - Each block gets a signature for collapsed display (e.g., `[impact] .command("impact <target>")`)

3. **IDF-weighted budget allocation**:
   - Each block is scored by keyword matches weighted by inverse document frequency — keywords appearing in fewer blocks score higher (so "impact" outranks "graph")
   - Imports always included first
   - Highest-scoring blocks included next, within a 10 000 char budget
   - Remaining blocks collapsed to one-line signatures: `// [viz] .command("viz") — 38 lines`
   - Reassembled in original file order

**Same file, different summaries per ADR:**
- ADR-003 checking `cli/index.ts` → expands `impact` command, collapses `viz`, `scan`, etc.
- ADR-004 checking `cli/index.ts` → expands `viz` command, collapses everything else
- ADR-007 checking `html-generator.ts` → expands treemap/layout blocks, collapses helpers

**Prompt addition:** A new rule tells the LLM not to treat collapsed blocks as evidence of absence:
> Lines marked "— N lines" are summaries of code blocks not shown. Do NOT count collapsed blocks as evidence of absence.

## Consequences

- Positive: Eliminates all 6 truncation-caused false judgments from v1 (aligned count 20→24, drifting 16→6)
- Positive: Accuracy improved from ~78% to ~88-90% across 52 bindings
- Positive: Parse errors eliminated (1→0) — LLM receives well-structured input
- Positive: Same budget (10 000 chars) carries more relevant information per token
- Negative: Keyword extraction uses a heuristic stop-word list that may need tuning for other codebases
- Negative: Block splitting assumes TypeScript/JavaScript indent-0 conventions — other languages need adapters
- Future: The summarizer can be reused for git hook integration (v0.3) and CI reporting
