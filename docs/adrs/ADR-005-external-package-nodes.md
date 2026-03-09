---
id: ADR-005
status: accepted
affects:
  - src/core/ast/scanner.ts
  - src/core/viz/html-generator.ts
  - src/types/graph.ts
---

# Track external package dependencies as nodes in the DAG

## Context

When testing on real projects (consola, express-typescript-boilerplate), many modules appeared as orphan nodes because they only import external packages (typeorm, routing-controllers, etc.). The scanner previously skipped all non-relative imports, losing significant dependency information.

## Decision

Create `external` module nodes for non-relative, non-builtin imports. Each unique package name becomes one node (e.g. `ext:typeorm`), with `depends_on` edges from importing modules. Node.js builtins (fs, path, etc.) are excluded.

The `language` field on ModuleNode gains an `"external"` value to distinguish these from source modules. In the visualization, external packages render as smaller blue nodes.

## Consequences

- Positive: orphan nodes largely eliminated — files importing only external packages now have visible edges
- Positive: reveals which external packages are most depended upon
- Positive: impact analysis now shows external dependencies (useful context for AI assistants)
- Negative: increases graph size — express-ts went from 77 to 116 nodes
