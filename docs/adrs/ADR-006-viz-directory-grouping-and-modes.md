---
id: ADR-006
status: accepted
affects:
  - src/core/viz/html-generator.ts
---

# Directory grouping, peripheral externals, and observation modes in visualization

## Context

When testing on real projects (consola, express-typescript-boilerplate), the flat force-directed graph became hard to read at 100+ nodes. Two problems stood out:

1. **No spatial structure** — modules from the same directory scattered across the canvas, making it hard to see which areas of the codebase are tightly coupled.
2. **External packages dominate the center** — external nodes (e.g. `ext:typeorm`) are highly connected and get pulled to the graph center by the force simulation, pushing the actual source code to the periphery.
3. **Labels overlap** — at high node counts, per-node labels become unreadable. A directory-level view would be more useful for orientation.

## Decision

### Directory grouping with convex hulls
Nodes are grouped by their directory path (e.g. `src/api/controllers`). ADRs, concepts, and external packages get special groups `(adr)`, `(concept)`, `(external)`. A clustering force nudges same-group nodes together, and convex hulls are drawn as translucent backgrounds to visualize group boundaries.

### External nodes excluded from clustering
External package nodes do not participate in the clustering force at all. They are not core project modules — the link force alone determines their position, which naturally places them at the edges near the modules that import them.

### Directory grid layout mode
A toggle ("Dir layout" in controls) switches from force-directed layout to a deterministic grid layout. Each directory group is assigned a fixed rectangular cell in a grid. Nodes within each cell are arranged in a mini-grid. External packages are placed in a dedicated strip at the bottom. This provides a stable, reproducible spatial map of the codebase structure. Toggling off restores the force-directed layout.

### Directory label observation mode
A toggle ("Dir labels" in controls) switches between per-node labels and per-directory labels. In directory mode, individual node labels are hidden, node circles shrink, and only the group centroid label is shown at a larger size with node count. This is useful for getting a high-level overview of large codebases.

### Hide externals toggle
A toggle to completely hide external package nodes and their edges, showing only the internal source code structure.

## Consequences

- Positive: large graphs become navigable — directory clusters are visually distinct
- Positive: external packages naturally drift to edges, no longer crowd the center
- Positive: directory grid layout gives a stable, deterministic spatial map — same project always looks the same
- Positive: directory label mode provides a useful "zoom out" for orientation
- Positive: hide externals lets users focus on internal structure
- Negative: grid layout ignores dependency topology — edges may cross cells; force-directed is better for seeing dependency flow
