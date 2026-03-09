---
id: ADR-016
status: accepted
affects:
  - src/core/semantic/prompt.ts
---

# Prompt optimization: add module imports and strengthen inference rules

## Context

The first round of LLM semantic inference (MiniMax M2.5) produced 39 inferred edges with ~60% accuracy. Root cause analysis of false positives revealed two issues:

1. **Missing structural context**: Each module line only showed `id | label | exports`. Without seeing which modules import which, the model guessed relationships based on name similarity alone — e.g., attributing ADR-008's click-inspect feature to `builder.ts` instead of `html-generator.ts`.

2. **Weak inference rules**: The prompt lacked explicit guidance on barrel files, test files, and evidence requirements, leading to over-broad "implements" edges.

## Decision

### Add imports to module lines

Each module line in the prompt now includes up to 10 import paths:

```
- mod:src/core/dag/builder | builder.ts | exports: buildDAG | imports: ../ast/scanner, ./adr-parser, ./store
```

This gives the model the dependency graph structure without requiring full source code.

### Strengthen inference rules

Replaced the original 6-line rules section with 9 precise rules:

- Tightened "implements" definition: the module's own code must have been written/modified to fulfill the decision (not just consumed or tested)
- Added import-verification rule: if ADR describes feature in module A but module B doesn't import A, B is unlikely related
- Explicitly excluded barrel/index.ts files and test files from "implements"
- Required specific evidence in "reason" field (quote ADR text + map to exports/imports)
- Added confidence threshold: "when in doubt, omit"

## Consequences

- Positive: Second round produced 10 edges (down from 39) with ~70% accuracy — precision improved significantly
- Positive: False positives from name-guessing largely eliminated
- Negative: 2 edges still incorrect (ADR-008 → graph.ts, ADR-008 → builder.ts) because the model cannot see inline code in html-generator.ts — this is a fundamental limit of metadata-only prompts
- Future: Sending code snippets for high-confidence candidates could further improve accuracy
