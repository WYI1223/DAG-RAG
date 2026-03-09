---
id: ADR-003
status: accepted
affects:
  - src/core/dag/impact.ts
  - src/cli/index.ts
---

# Implement impact analysis as pure graph traversal without LLM

## Context

The `impact` command is the project's core value proposition — "before changing this file, see what it affects." The ROADMAP originally placed it in v0.2 alongside the LLM semantic layer.

However, most of the useful impact information is already available from the structural DAG alone: governing ADRs, sibling modules, upstream/downstream dependencies. These are all graph traversal operations that require no LLM.

## Decision

Implement `impact` as pure graph traversal in v0.1, independent of the semantic layer. It accepts either a file path or ADR ID and walks the DAG to report:

- **For modules:** governing ADRs, sibling modules (share same ADR bindings), depends-on and depended-by relationships
- **For ADRs:** implementing modules, supersedes/conflicts chains, internal dependency subgraph among affected modules

The LLM layer (v0.2) will later enrich this with drift status and confidence scores, but the structural report is independently useful.

## Consequences

- Positive: the project delivers real value before the LLM layer exists
- Positive: the output can already be pasted into an AI assistant's context window as architectural constraints
- Positive: no external API dependency for the core feature
- Negative: cannot detect semantic drift (e.g. "this code no longer follows the ADR's intent") — that still requires v0.2
