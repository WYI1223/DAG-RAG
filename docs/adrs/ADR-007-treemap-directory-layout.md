---
id: ADR-007
status: accepted
supersedes: ADR-006 (directory grid layout section)
affects:
  - src/core/viz/html-generator.ts
---

# Use treemap layout for directory observation mode

## Context

The flat grid layout introduced in ADR-006 assigned each directory group to an equal-sized cell. This worked for small projects but had issues at scale:

1. **No hierarchy visible** — `src/core/ast` and `src/core/dag` appeared as unrelated cells, losing the nesting relationship.
2. **External packages dominated** — the `(external)` group's convex hull covered the entire graph center in force-directed mode, obscuring source code structure.
3. **Equal cell sizes wasted space** — a directory with 1 file got the same area as one with 20.

The user requested a SpaceSniffer-style treemap: root as a big block, subdirectories nested inside proportional to their node count.

## Decision

### Treemap-based directory layout
Replace the flat grid with a D3 treemap (`d3.treemap()`). Directory paths are parsed into a trie, converted to a `d3.hierarchy`, and laid out with squarified treemap. Each level draws a labeled rectangle — root is the outermost, leaf directories are innermost. Area is proportional to node count. External packages get a dedicated strip at the bottom, outside the treemap.

### External nodes excluded from convex hulls
In force-directed mode, the `(external)` group is excluded from hull rendering entirely. External nodes float freely based on link force alone.

### ADR append-only convention
ADRs are immutable once written. New decisions supersede old ones via a new ADR rather than editing the original. This preserves the decision history.

## Consequences

- Positive: directory hierarchy is immediately visible — nested rectangles show `src > core > dag`
- Positive: area reflects importance — directories with more modules get more space
- Positive: external packages no longer obscure the graph in either mode
- Positive: switching between force-directed and treemap gives two complementary views
- Negative: very deep directory trees may produce tiny rectangles for leaf nodes
