---
id: ADR-001
status: accepted
affects:
  - src/core/ast/
  - src/core/dag/
supersedes:
---

# Use TypeScript Compiler API for structural analysis

## Context

We need to build a reliable dependency graph from source code. The graph forms the
certain layer of our system — all edges at this layer must be deterministic and
verifiable without LLM involvement.

## Decision

Use the TypeScript Compiler API (`typescript` npm package) as the primary AST tool
for TypeScript projects. It provides both syntax-level and type-level analysis,
giving us access to:
- Import/export relationships
- Interface and type declarations
- Call graphs (future)

## Consequences

- Positive: fully deterministic, same input always produces same graph
- Positive: type information available for deeper analysis in future phases
- Negative: TypeScript-only for Phase 1; other languages need separate adapters
- Negative: large projects may have slow initial scan (acceptable for cold-start)
