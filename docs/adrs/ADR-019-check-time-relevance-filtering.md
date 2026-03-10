---
id: ADR-019
status: accepted
affects:
  - src/core/semantic/checker.ts
  - src/cli/index.ts
---

# Check-time relevance filtering instead of scan-time binding exclusion

## Context

ADR-018 introduced ADR-aware code summarization to improve check accuracy. The next question was how to reduce token cost: a full check across 52 bindings consumed ~137k input / ~38k output tokens.

One approach considered was **scan-time filtering** — when `affects: src/core/dag/` expands to all files in a directory, use keyword matching to skip modules that don't match ADR keywords. This would reduce binding count in the DAG itself.

The problem: scan-time filtering produces **false negatives**. Example: ADR-005 (external package nodes) affects `store.ts` because it serializes the DAG including external nodes — but `store.ts` never mentions "external" or "ext:" directly. Keyword matching would skip it, producing an incomplete graph.

A DAG with missing edges is more dangerous than one with extra edges. Missing edges mean drift goes undetected silently.

## Decision

**Never filter bindings at scan time. Filter at check time only, using keyword relevance as prioritization.**

1. **Scan/build stage**: unchanged. Directory-level `affects` paths expand to all matching modules. The DAG remains complete.

2. **Check stage**: before sending each binding to the LLM, compute a quick keyword relevance score (reusing `extractKeywords` from ADR-018's code-summarizer):
   - Extract keywords from the ADR
   - Read the module's source code
   - Count keyword hits in the source
   - Score > 0 → **high relevance**: always checked
   - Score = 0 → **low relevance**: skipped by default

3. **CLI interface**:
   ```bash
   adr-graph check              # default: skip low-relevance bindings
   adr-graph check --all        # check all bindings regardless of relevance
   ```

4. **Output**: when bindings are skipped, display a summary line:
   ```
   ℹ Skipped N low-relevance bindings (use --all to include)
   ```

## Consequences

- Positive: DAG completeness preserved — no false negatives in the graph
- Positive: Token cost reduced in default mode — only high-relevance bindings are checked
- Positive: `--all` flag provides escape hatch for thorough checks
- Positive: Keyword scoring is nearly zero-cost (no LLM calls, just string matching)
- Negative: Low-relevance bindings may contain real drift that goes unchecked in default mode
- Mitigation: Users can periodically run `--all` for comprehensive checks
