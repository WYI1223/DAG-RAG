---
id: ADR-009
status: accepted
affects:
  - src/core/semantic/
  - src/cli/index.ts
---

# Direct Anthropic API for semantic edge inference

## Context

The structural DAG (v0.1) only contains `depends_on` edges from AST analysis and `implements`/`supersedes` edges from ADR frontmatter. The project's core value proposition — binding ADRs to code semantically — requires LLM analysis to infer relationships that cannot be determined structurally.

Three integration approaches were considered:

1. **Direct HTTP API** — use `@anthropic-ai/sdk` to call Claude directly. Simple, zero abstraction, full control.
2. **MCP (Model Context Protocol)** — expose adr-graph as an MCP server or consume LLM via MCP. Good ecosystem fit but requires external AI client.
3. **Provider abstraction layer** — define a `LLMProvider` interface supporting multiple backends. Flexible but premature for a single-provider v0.2.

For the inference strategy:

- **Batch on scan** — analyze all active ADRs against the codebase during `init`/`scan`.
- **Human-in-the-loop confirmation** — all LLM-produced edges are `certainty: "inferred"` until a human confirms them.
- **Incremental on diff** — deferred to git hook integration (future work).

## Decision

### Direct Anthropic API (approach 1)

Use `@anthropic-ai/sdk` with API key from `ADR_GRAPH_ANTHROPIC_KEY` environment variable. Model defaults to `claude-sonnet-4-20250514`, overridable via `ADR_GRAPH_MODEL`. Graceful degradation: if no API key is set, the semantic layer is silently skipped and the structural DAG is produced as before.

### Batch inference during scan (strategy A + C)

During `init` and `scan`, each active ADR (not deprecated/superseded) is analyzed against relevant code modules. The LLM receives: ADR text, compressed module list, and existing bindings. It outputs a JSON array of inferred edges with confidence scores and reasons.

All inferred edges are written to `dag.json` with `certainty: "inferred"`. They are never auto-promoted to `certain`. A future `confirm` command will allow human sign-off.

### Module filtering heuristic

To stay within the ~4000 token input budget, modules are filtered by relevance: path-keyword overlap with ADR body/title, boosted by frontmatter `affects` declarations. External packages are excluded. Maximum 80 modules per prompt.

### Edge preservation on re-scan

When `scan` rebuilds the DAG, all previously inferred edges whose `from` and `to` nodes still exist are preserved. New inferred edges are added without overwriting existing ones (certain or inferred). This handles LLM non-determinism — edges inferred in a previous scan are not lost if the LLM doesn't re-infer them.

### CLI opt-out

Both `init` and `scan` accept `--no-semantic` to skip LLM analysis entirely, independent of whether the API key is set.

## Consequences

- Positive: the DAG now contains semantic edges (`implements`, `affects`) that were previously invisible
- Positive: graceful degradation means the tool works identically for users without an API key
- Positive: `certainty: "inferred"` + confidence scores maintain the certain/inferred separation established in the type system
- Positive: edge preservation across scans prevents data loss from LLM non-determinism
- Negative: each ADR = one API call; projects with many ADRs incur cost and latency
- Negative: no provider abstraction yet — switching to a different LLM requires code changes
