---
id: ADR-004
status: accepted
affects:
  - src/core/viz/
  - src/cli/index.ts
---

# Generate self-contained HTML visualization using D3.js via CDN

## Context

The DAG needs to be visible outside the terminal. Options considered:

- **Electron app** — heavy, requires separate install, overkill for a graph viewer
- **React/Svelte SPA with build step** — adds bundler dependency, increases project complexity
- **Self-contained HTML with D3.js via CDN** — zero build step, single file output, opens in any browser

## Decision

Use D3.js force-directed graph loaded via CDN in a single self-contained HTML file. The `viz` command serializes the DAG data as inline JSON and writes a complete HTML file that can be opened directly in a browser.

No additional npm dependencies are added — D3 is loaded at runtime from CDN.

## Consequences

- Positive: zero extra dependencies, no build step for the visualization
- Positive: output is a single portable HTML file, easy to share or archive
- Positive: works offline after first load (browser caches D3 from CDN)
- Negative: requires internet connection on first open to load D3
- Negative: customization requires editing the HTML template string in TypeScript
