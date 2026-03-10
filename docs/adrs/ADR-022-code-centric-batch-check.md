---
id: ADR-022
status: accepted
affects:
  - src/core/semantic/checker.ts
  - src/core/semantic/check-prompt.ts
  - src/cli/index.ts
---

# Code-centric batch check with ADR evolution context

## Context

The current check command is ADR-centric: for each (ADR, Module) binding it sends one LLM call containing the ADR body and the module source code. When a module is governed by N ADRs, the source code is transmitted N times — wasting tokens on duplicate context.

More critically, ADRs evolve over time. ADR-009 says "Direct Anthropic API only", but ADR-010 later extends this to multi-provider support. Because each LLM call only sees one ADR at a time, it cannot distinguish intentional evolution from real drift. This produces false-positive "drifting" results for decisions that were deliberately superseded.

## Decision

Restructure the check loop from ADR-centric to **code-centric (module-centric)**:

### Grouping

Instead of iterating over (ADR, Module) pairs, group all bindings by module:

```
client.ts → [ADR-009 (implements), ADR-010 (implements), ADR-012 (implements), ...]
analyzer.ts → [ADR-009 (implements), ADR-011 (implements), ...]
```

Each group becomes one LLM call.

### Prompt structure

One prompt per module, containing:

1. **Module source code** (sent once, using existing `summarizeForCheck`)
2. **All governing ADRs** listed chronologically (ID, title, body) — the LLM sees the full evolution chain
3. **Binding list** specifying which ADR binds to this module and with what kind (implements/affects)

### Output format

The LLM returns a JSON array with one result per binding:

```json
[
  { "adrId": "ADR-009", "status": "aligned", "relevance": "related", "reason": "..." },
  { "adrId": "ADR-010", "status": "drifting", "relevance": "related", "reason": "..." }
]
```

### ADR body budget

To control prompt size when many ADRs govern one module, each ADR body is truncated to fit within a per-ADR budget. The total ADR budget is capped (e.g. 20000 chars) and divided equally among the ADRs in the group. If the group has 5 ADRs, each gets 4000 chars.

### Prompt instruction for evolution

The prompt explicitly instructs the LLM:

> ADRs are listed chronologically. Later ADRs may extend, modify, or supersede earlier ones. If the code diverges from an earlier ADR but aligns with a later ADR that explicitly changes that aspect, evaluate the earlier ADR as "aligned" (intentional evolution), not "drifting".

### What stays the same

- Three-tier relevance classification (ADR-021) — unchanged
- DAG mutation (prune unrelated, mark possibly_related) — unchanged
- `--all` flag behavior — unchanged
- Verbose logging and progress display — adapted for batch output
- Filtering previously resolved edges — unchanged

## Consequences

- Positive: eliminates false-positive drift from ADR evolution — the LLM sees the full decision history per module
- Positive: source code sent once per module instead of N times — estimated 30-40% token reduction
- Positive: fewer LLM calls (number of unique modules instead of number of bindings)
- Positive: LLM can make cross-ADR judgments (e.g. "this pattern satisfies both ADR-X and ADR-Y")
- Negative: single LLM call failure affects all bindings for that module (mitigated by error handling per group)
- Negative: prompt is larger per call (more ADR text), but total tokens decrease
- Negative: output parsing is more complex (array with adrId matching)
