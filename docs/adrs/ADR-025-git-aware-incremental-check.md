# ADR-025: Git-Aware Incremental Check

## Status

Accepted

## Context

The `check` command sends every ADR-module binding to the LLM for drift evaluation. On a project with 15+ modules, this costs ~100k tokens per run. Most of these bindings haven't changed since the last check. Running a full check after every small code change is wasteful.

We need `check --changed` to only evaluate bindings affected by recent git changes, reducing token cost by 80-90% for incremental checks.

## Decision

### Git diff extraction

A new module `src/core/git/diff.ts` extracts changed files using three git commands:
- `git diff --name-only <ref> HEAD` (committed changes since ref)
- `git diff --name-only --cached` (staged changes)
- `git diff --name-only` (unstaged modifications)

The union of these three sources captures all relevant changes.

### Ref resolution priority

When determining what to diff against:
1. User-specified `--ref <ref>` takes highest priority
2. Latest `SemanticSnapshot.commitHash` from `dag.snapshots` (i.e., "since last check")
3. Fallback to `HEAD~1` when no snapshots exist

### ADR change propagation

When an ADR file changes, all modules bound to that ADR (via `implements` or `affects` edges) are included in the check. This ensures that revised decision text triggers re-evaluation of all implementing code.

### Integration with existing checker

A new `filterModuleIds: Set<string>` option is added to `CheckOptions`. The `collectBindings` function filters bindings to only include modules in this set. The rest of the checker pipeline (groupByModule, LLM calls, result aggregation) works unchanged.

### Snapshot creation

After each successful `check`, a `SemanticSnapshot` is created anchored to the current `git rev-parse HEAD`. This enables the next `--changed` run to automatically diff against the last checked state.

### Graceful degradation

If `--changed` fails (no git repo, invalid ref), the CLI warns and falls back to a full check. The `--changed` flag is purely additive — it never prevents checking.

## Consequences

- `check --changed` reduces token cost by ~85-90% for incremental changes
- Snapshot history grows by one entry per check run (acceptable for JSON storage)
- External modules (`ext:` prefix) are excluded from expansion
- The `GitExecutor` injection pattern enables full unit testing without real git repos
- `--changed` composes with existing filters: `check src/core/ --changed` narrows further

## Implements

- src/core/git/diff.ts
- src/core/semantic/checker.ts
- src/cli/index.ts

## Affects

- tests/git-diff.test.ts
