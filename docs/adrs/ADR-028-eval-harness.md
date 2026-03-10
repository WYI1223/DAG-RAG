# ADR-028: Eval Harness for LLM Pipeline

## Status
Accepted

## Context
ligare has two LLM-powered pipeline stages:
1. **`scan`** — infers `implements`/`affects` edges from ADRs to modules
2. **`check`** — evaluates existing bindings for drift (`aligned`/`drifting`/`broken`/`unrelated`/`possibly_related`)

Both stages rely on prompt engineering and model behavior. When prompts change (ADR-016, ADR-022), models change (Haiku → Sonnet → Opus), or caching layout changes (ADR-026), there is no systematic way to verify quality hasn't regressed. Today, validation is manual: run the command, read the output, judge by eye.

An eval harness provides repeatable, quantitative evaluation against hand-labeled ground truth.

## Decision

### Scope: `check` first
Start with `check` evaluation only. Reasons:
- `check` produces discrete labels per binding — easy to compare against ground truth
- `check` is the higher-stakes call — a missed drift (false negative) is worse than a missed edge
- `scan` edge inference is harder to label (what "should" be an edge is subjective)

`scan` eval can be added later using the same framework.

### Golden Set
A JSON file of hand-labeled bindings pinned to a specific git commit:

```json
{
  "commit": "abc1234",
  "project": "ligare-self",
  "bindings": [
    {
      "adrId": "ADR-009",
      "moduleId": "src/core/semantic/client.ts",
      "expectedRelevance": "related",
      "expectedStatus": "aligned",
      "note": "Client implements the LLM integration described in ADR-009"
    }
  ]
}
```

Fields:
- `commit` — the exact git commit this golden set is valid for. Code changes invalidate labels.
- `expectedRelevance` — `related` | `possibly_related` | `unrelated`
- `expectedStatus` — `aligned` | `drifting` | `broken` (only meaningful when relevance is `related`)
- `note` — human rationale for the label (documentation, not used by eval)

### Golden Set Source
Use ligare's own project (`docs/adrs/` + `src/`). The maintainer already manually verifies `check` output — formalize those judgments into golden labels. Start with 20–30 bindings covering:
- Clear aligned cases (ADR-023 → checker.ts)
- Clear unrelated cases (ADR-004 viz → semantic/client.ts)
- Known drifting cases (if any exist)
- Edge cases: `possibly_related`, external modules (should be excluded)

### Eval Command
`ligare eval` — a new CLI command, not part of CI.

```
ligare eval [--golden <path>] [--root <dir>] [--verbose]
```

Workflow:
1. Load golden set JSON
2. Verify current commit matches golden set commit (warn if not)
3. Run `checkDrift()` on the golden bindings only
4. Compare LLM verdicts against golden labels
5. Output report

### Metrics

**Per-binding comparison:**
- Relevance match: `expectedRelevance` vs actual `relevance`
- Status match: `expectedStatus` vs actual `status` (only when both are `related`)

**Aggregate metrics:**
- **Accuracy**: % of bindings where both relevance and status match
- **Relevance accuracy**: % where relevance matches (regardless of status)
- **Status accuracy**: % where status matches (among `related`-only bindings)
- **Confusion matrix**: 5×5 for relevance×status combinations
- **Critical misses**: count of `drifting`/`broken` labeled as `aligned` (the worst failure mode)
- **Token cost**: total input/output/cache tokens for the eval run
- **Duration**: wall-clock time

### Output Format
Markdown report to stdout (and optionally to `.ligare/eval-{timestamp}.md`):

```markdown
# Eval Report — 2026-03-10T12:00:00Z
Commit: abc1234 | Model: claude-sonnet-4-20250514 | Bindings: 25

## Summary
| Metric | Value |
|--------|-------|
| Overall accuracy | 88% (22/25) |
| Relevance accuracy | 92% (23/25) |
| Status accuracy | 85% (17/20) |
| Critical misses | 0 |
| Tokens | 12,400 in / 3,200 out (cache: 8,100 read) |
| Duration | 34s |

## Mismatches
| ADR | Module | Expected | Actual | Note |
|-----|--------|----------|--------|------|
| ADR-004 | semantic/client.ts | unrelated | possibly_related | ... |
```

### What Eval Does NOT Do
- **No CI integration** — costs API tokens, runs manually
- **No LLM-as-judge** — golden set is small enough for human labeling
- **No auto-update of golden set** — labels are maintained manually
- **No `scan` eval yet** — deferred until check eval proves useful
- **No cross-project eval** — ligare-self only for now

### Loop Safety
The eval harness inherits the unbounded tool-use loop from `analyzeWithTools`. For eval runs, add a `maxToolRounds` option (default: 10) to prevent runaway LLM loops from burning tokens during batch evaluation.

### File Layout
```
src/core/eval/
  runner.ts          # Runs checkDrift on golden bindings, compares results
  report.ts          # Formats markdown report
tests/eval/
  golden-ligare.json # Golden set for ligare-self project
```

## Consequences
- **Positive**: Prompt changes and model swaps can be evaluated quantitatively before shipping.
- **Positive**: "Critical misses" metric directly measures the worst failure mode (missed drift).
- **Positive**: Token cost tracking per eval run enables cost-aware prompt optimization.
- **Positive**: Golden set doubles as documentation of expected behavior.
- **Negative**: Golden set maintenance cost — labels become stale when code changes. Mitigated by pinning to commit.
- **Negative**: Small golden set (20–30 bindings) may not catch rare edge cases. Acceptable for v1.
- **Risk**: Unbounded tool-use loop in `analyzeWithTools` could burn tokens during eval. Mitigated by `maxToolRounds` guard.
