---
id: ADR-008
status: accepted
supersedes: ADR-007 (interaction details)
affects:
  - src/core/viz/html-generator.ts
---

# Click-to-inspect and treemap interaction design

## Context

After implementing the treemap directory layout (ADR-007), edges between nodes across different directory cells created visual clutter. Showing all edges simultaneously made the treemap unreadable. Additionally, nodes placed in treemap cells needed intuitive interaction — positioning, dragging, and resetting.

Several approaches were tried and rejected:

1. **Hover-based edge reveal** — showing edges on mouse hover was too transient and disorienting.
2. **Mini force-directed within cells** — letting nodes settle via link forces inside their cells pulled nodes toward cell edges/corners where cross-cell dependencies were, defeating the purpose of uniform layout.

## Decision

### Click-to-inspect with directional coloring

Left-clicking a node enters inspection mode: only edges directly connected to that node are shown, all others are hidden. Connected edges are colored directionally:

- **Green (#7ee787)** — outgoing edges: the selected node depends on the target
- **Orange (#ffa657)** — incoming edges: the source depends on the selected node

Dedicated SVG arrow markers (`arrow-out`, `arrow-in`) match these colors. Unrelated nodes are dimmed to 0.15 opacity. Clicking the same node again, clicking the background, or clicking a different node exits/changes the selection.

Directed adjacency indices (`outEdges`, `inEdges`) are precomputed at initialization for O(1) lookup during inspection.

### Edges hidden by default in treemap mode

When the directory layout is active, all edges are hidden (`display: none`). Edges only become visible through click-to-inspect. When the layout is deactivated, edge visibility returns to filter-checkbox state.

### Uniform node distribution in cells

Nodes within each treemap leaf cell are arranged in a uniform grid pattern (column-major). Positions are computed deterministically and pinned via `fx`/`fy`. This avoids the problems of force-directed layout within cells where cross-cell links distort node placement.

### Drag constrained to cell bounds

In treemap mode, dragging a node clamps its position to within its directory cell (with 10px padding). The node stays pinned (`fx`/`fy` retained) at its dragged position after release, allowing users to manually arrange nodes within their cell.

### Double-click to reset position

Double-clicking a node in treemap mode resets it to its original computed grid position from `dirLayoutPositions`. This provides an undo for manual repositioning.

## Consequences

- Positive: treemap mode is clean — edges appear only on demand, one node at a time
- Positive: directional coloring makes dependency direction immediately obvious without reading labels
- Positive: uniform grid prevents nodes from clustering at cell boundaries
- Positive: drag-within-cell lets users fine-tune layout without breaking the directory structure
- Positive: double-click reset provides a safe way to undo manual positioning
- Negative: only direct connections are shown per click — transitive dependencies require multiple clicks to trace
