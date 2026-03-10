---
id: ADR-020
status: accepted
affects:
  - src/core/dag/builder.ts
  - src/core/dag/adr-parser.ts
---

# Separate frontmatter affects and implements edge semantics

## Context

Builder.ts has a bug: the `affects` field in ADR frontmatter creates `implements` edges for ALL matched modules (line 75-80). When `affects` lists a directory like `src/core/dag/`, every file under that directory gets an `implements` edge — but most of those files don't directly implement the ADR's decision.

This produced 15+ misbound bindings in our own project's check results. ADR-001 (TypeScript Compiler API) had `affects: src/core/dag/` which expanded to builder.ts, store.ts, impact.ts, adr-parser.ts — all marked as `implements` even though only scanner.ts actually uses the TypeScript Compiler API.

The root cause: there was no way to distinguish "this file implements this decision" from "this file is affected by this decision" in frontmatter.

## Decision

### Two frontmatter fields with distinct edge types

```yaml
---
implements:
  - src/core/ast/scanner.ts     # → implements edge
affects:
  - src/core/dag/               # → affects edges for all files under dag/
---
```

- `implements` field → creates `implements` edges (certainty: "certain")
- `affects` field → creates `affects` edges (certainty: "certain")
- Both support exact file paths and directory prefix expansion

### Parser change

`AdrFrontmatter` gains an `implements?: string[]` field alongside the existing `affects?: string[]`.

### Builder change

Builder processes both fields separately, creating the correct edge kind for each.

## Consequences

- Positive: frontmatter semantics match edge semantics — `affects` creates `affects` edges
- Positive: eliminates 15+ misbound bindings caused by directory expansion + wrong edge kind
- Positive: check command's `implements` evaluation becomes meaningful (only files that truly implement)
- Negative: existing ADR frontmatters need updating to use the new `implements` field where appropriate
- Negative: backwards compatibility — old frontmatters with only `affects` will now create `affects` edges instead of `implements`, which changes check behavior
