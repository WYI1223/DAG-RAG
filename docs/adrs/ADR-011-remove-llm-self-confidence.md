---
id: ADR-011
status: accepted
supersedes: ADR-009 (confidence scoring section)
affects:
  - src/core/semantic/prompt.ts
  - src/core/semantic/analyzer.ts
---

# Remove LLM self-assessed confidence, require evidence-based reason

## Context

ADR-009 had the LLM output a `confidence` score (0.0–1.0) for each inferred edge. In practice, LLM self-assessed confidence is unreliable — models can assign high confidence to incorrect inferences. The number gives a false sense of precision that doesn't help the user decide whether to trust an edge.

Meanwhile, the `reason` field — a free-text explanation — is far more useful for human review. If the reason cites specific ADR text and explains how it maps to a module, the user can judge the inference quality directly.

## Decision

Remove the `confidence` field from the LLM output format and the `InferredEdge` type. Inferred edges no longer carry a numeric confidence score.

The `reason` field is strengthened: the prompt now requires 1–2 sentences that cite specific evidence from the ADR text and explain how it maps to the module. The instruction "Only include relationships you are confident about. When in doubt, omit." replaces the previous `confidence >= 0.5` threshold — the LLM self-filters by omitting uncertain edges rather than scoring them.

The `GraphEdge.confidence` field in the type system is left unchanged (it remains optional) for backwards compatibility with any existing dag.json files. New inferred edges simply do not set it.

## Consequences

- Positive: no false precision — users read the reason instead of trusting an unreliable number
- Positive: simpler LLM output format, fewer parsing edge cases
- Positive: prompt space saved by removing confidence instructions, used for stronger evidence requirements
- Negative: no numeric signal for automated filtering or sorting of inferred edges — all inferred edges are equal until human review
