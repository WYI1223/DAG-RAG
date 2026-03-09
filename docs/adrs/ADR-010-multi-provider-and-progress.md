---
id: ADR-010
status: accepted
supersedes: ADR-009 (provider and UX sections)
affects:
  - src/core/semantic/client.ts
  - src/core/semantic/analyzer.ts
  - src/cli/index.ts
---

# Multi-provider LLM client with progress reporting

## Context

ADR-009 established direct Anthropic API integration for semantic edge inference. Two gaps emerged immediately:

1. **Single provider** — users with AWS Bedrock, Google Vertex AI, or Anthropic-compatible APIs (e.g. MiniMax) had no way to use the semantic layer without an Anthropic API key.
2. **No progress feedback** — semantic analysis makes one API call per ADR. On projects with many ADRs, the CLI showed a single spinner with no indication of progress, errors, or which ADR was being processed.

## Decision

### Provider-switching client

The semantic client auto-detects available credentials in priority order:

1. `ADR_GRAPH_ANTHROPIC_KEY` → Anthropic API (direct)
2. `AWS_REGION` → AWS Bedrock (uses AWS default credential chain)
3. `ANTHROPIC_VERTEX_PROJECT` + `CLOUD_ML_REGION` → Google Vertex AI
4. `ADR_GRAPH_COMPATIBLE_KEY` + `ADR_GRAPH_COMPATIBLE_URL` + `ADR_GRAPH_MODEL` → any Anthropic Messages API-compatible service (e.g. MiniMax at `https://api.minimaxi.com/anthropic`)

`ADR_GRAPH_PROVIDER` can force a specific provider, bypassing auto-detection. `ADR_GRAPH_MODEL` overrides the model ID for any provider. The `compatible` provider requires an explicit model since there is no sensible default.

All four providers share the same `buildClient` function — the `@anthropic-ai/sdk`, `@anthropic-ai/bedrock-sdk`, and `@anthropic-ai/vertex-sdk` all expose an identical `messages.create` interface, so no adapter layer is needed. The compatible provider reuses the base Anthropic SDK with a custom `baseURL`.

### Progress callback for analysis

`analyzeSemantics` accepts an optional `onProgress` callback that fires:
- Before each ADR analysis (`status: "analyzing"`)
- After success (`status: "done"`)
- After failure (`status: "error"`)

Each callback includes: current/total count, ADR ID, cumulative edges added. The CLI uses this to update the spinner text in real-time: `[3/8] ✓ ADR-003  (+2 edges)`.

### Explicit error messages

API failures now display the actual error message (`401 Unauthorized`, `timeout`, `invalid model`) instead of a generic "failed" message. Per-ADR errors are printed individually after the spinner completes.

## Consequences

- Positive: users with Bedrock/Vertex/MiniMax credentials can use semantic analysis without an Anthropic API key
- Positive: the compatible provider makes any Anthropic-compatible API work with zero code changes
- Positive: progress reporting gives visibility into long-running analysis — users know which ADR is being processed and whether errors occurred
- Positive: no adapter abstraction needed — all SDKs share the same `messages.create` interface
- Negative: three SDK dependencies (`@anthropic-ai/sdk`, `bedrock-sdk`, `vertex-sdk`) increase install size
- Negative: compatible provider depends on third-party API compatibility — breaking changes upstream may cause silent failures
