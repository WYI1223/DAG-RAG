---
id: ADR-012
status: accepted
affects:
  - src/core/semantic/client.ts
  - src/core/semantic/analyzer.ts
  - src/cli/index.ts
---

# Token usage metrics and throughput reporting

## Context

The semantic analysis phase makes one LLM API call per ADR. Users need visibility into resource consumption (tokens) and performance (throughput) to evaluate cost and compare providers. The previous implementation returned only the text response, discarding the usage metadata that all Anthropic-compatible APIs include in their responses.

## Decision

### AnalyzeResult with token metrics

`SemanticClient.analyze()` now returns an `AnalyzeResult` object instead of a plain string:

```typescript
interface AnalyzeResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
}
```

The client reads `response.usage.input_tokens` and `response.usage.output_tokens` from the API response and measures wall-clock duration via `Date.now()` delta.

### Per-ADR throughput in progress callback

The `AnalysisProgress` callback includes `tokensPerSec` (output tokens / seconds) for each completed ADR call. The CLI spinner shows this in real-time: `[3/8] ✓ ADR-003  (+2 edges)  47 tok/s`.

### Summary statistics

`SemanticAnalysisResult` now includes `totalInputTokens`, `totalOutputTokens`, and `totalDurationMs`. The CLI prints a summary after completion: `Inferred 5 semantic edges from 8 ADRs  (3200 in / 420 out, 52 tok/s)`.

## Consequences

- Positive: users can estimate API cost from input/output token counts
- Positive: throughput display helps compare providers (Anthropic vs Bedrock vs MiniMax)
- Positive: slow responses are immediately visible, not hidden behind a generic spinner
- Negative: `durationMs` is wall-clock time including network latency, not pure inference time
