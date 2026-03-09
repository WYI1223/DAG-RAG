---
id: ADR-002
status: accepted
affects:
  - src/core/ast/
  - src/core/dag/
---

# Use Vitest as the test framework

## Context

The project has zero tests. Before adding features (semantic layer, git hooks), we need a test foundation for the core modules: AST scanner, ADR parser, and DAG builder.

Options considered:
- **Jest** — widely used, but ESM support is still awkward with TypeScript
- **Vitest** — native ESM, zero-config with TypeScript, fast, compatible with Jest API
- **Node built-in test runner** — minimal dependencies, but limited assertion library and no watch mode

## Decision

Use Vitest. It handles ESM + TypeScript natively without extra configuration, which matches our `"type": "module"` setup. The Jest-compatible API means low learning curve.

## Consequences

- Positive: no babel/transform config needed, works out of the box with our tsconfig
- Positive: fast feedback loop with watch mode during development
- Negative: one more dev dependency
