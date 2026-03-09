---
id: ADR-015
status: accepted
affects:
  - src/core/semantic/client.ts
  - src/core/semantic/analyzer.ts
  - src/cli/index.ts
---

# Extract thinking blocks to verbose log and fix tok/s display

## Context

Two UX issues found during testing with MiniMax M2.5:

1. **Thinking content invisible**: Models that produce thinking blocks (extended reasoning) consume significant output tokens on internal reasoning. This content was silently discarded — users had no way to see what the model was "thinking", making it hard to debug why certain edges were or weren't inferred.

2. **tok/s not visible in progress**: The `tokensPerSec` value was only emitted in the "done" progress callback, which was immediately overwritten by the next ADR's "analyzing" callback. Users could never see the throughput during the run.

## Decision

### Thinking block extraction

`AnalyzeResult` now includes an optional `thinking?: string` field. The client extracts it from `response.content.find(b => b.type === "thinking")`. When `--verbose` is used, thinking content is written to the log file with a dedicated section header:

```
--- [ADR-005] thinking ---
(model's internal reasoning...)

--- [ADR-005] response (1106 in / 948 out, 19815ms) ---
[{"kind": "affects", ...}]
```

### Running average tok/s

Changed from per-ADR tok/s (which flashed and disappeared) to a running average across all completed calls. This is now emitted in both "analyzing" and "done" progress callbacks, so the spinner always shows a stable throughput number from the second ADR onward:

```
[4/12] … ADR-004  (+3 edges)  42 tok/s
```

## Consequences

- Positive: `--verbose` log now shows full model reasoning, enabling debugging of edge inference decisions
- Positive: tok/s is always visible during the analysis run, not just for a brief flash
- Positive: running average gives a more stable, meaningful throughput metric than per-call spikes
