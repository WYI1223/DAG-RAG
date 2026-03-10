---
id: ADR-021
status: accepted
affects:
  - src/core/semantic/checker.ts
  - src/core/semantic/check-prompt.ts
  - src/cli/index.ts
  - src/types/graph.ts
---

# Three-tier relevance classification in drift check

## Context

ADR-019 introduced keyword-based relevance filtering at check time. In practice it was too coarse — only 3 out of 80 bindings were filtered because domain vocabulary (graph, node, edge) appears in nearly every file.

The current check uses a binary `misbound: boolean` flag. This loses information: some misbound bindings are clearly wrong (ADR-002/Vitest → scanner.ts), while others are borderline (ADR-005/external nodes → html-generator.ts, which renders external nodes but doesn't create them). Both get the same treatment.

Meanwhile, 40% of bindings in our full check were misbound — wasting 100k+ tokens on bindings that will never be relevant again.

## Decision

Replace the binary `misbound` flag with a three-tier relevance classification:

### LLM output format change

```json
{
  "status": "aligned" | "drifting" | "broken",
  "relevance": "related" | "possibly_related" | "unrelated",
  "reason": "..."
}
```

### Tier definitions

- **related**: The module has a clear, direct relationship to the ADR's core decision. Proceed with normal status evaluation (aligned/drifting/broken).
- **possibly_related**: The module has an indirect or tangential relationship. The connection exists but is weak — e.g., the module consumes the output of the decision but doesn't implement or directly depend on it. Status evaluation may be unreliable.
- **unrelated**: The module has no meaningful relationship to the ADR. The binding is incorrect and should be removed.

### Behavior per tier

| Tier | Display | dag.json | Next check |
|------|---------|----------|------------|
| related | Normal status (aligned/drifting/broken) | Keep edge as-is | Always check |
| possibly_related | Show with `?` marker + reason | Add `metadata.relevance = "possibly_related"` | Skip by default, include with `--all` |
| unrelated | Show with `✖` marker + reason | Remove edge from dag.json | Never check again |

### Replacing ADR-019's keyword filtering

The keyword-based `computeRelevance` function (ADR-019) is removed. The LLM's three-tier classification is strictly more accurate because it reads actual source code and ADR text, not just keyword overlap.

The `--all` flag remains but changes meaning:
- Default: skip `possibly_related` edges from previous checks
- `--all`: include `possibly_related` edges, re-evaluate everything

## Consequences

- Positive: 40% of bindings (unrelated) are permanently pruned after first check — massive token savings on subsequent runs
- Positive: borderline cases preserved for human review instead of auto-deleted
- Positive: replaces inaccurate keyword heuristic with LLM judgment
- Positive: DAG accuracy improves over time — each check run refines the graph
- Negative: first check still costs full tokens (no pre-filtering)
- Negative: LLM must now output a three-way classification, slightly more complex prompt
