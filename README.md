# adr-graph

> **Semantic Git** — a layer above Git that records not just *what* changed, but *why*.

Most codebases accumulate a silent gap between intent and implementation. Architecture decisions get written down (if at all) in documents that no one reads, while the code drifts quietly away from the original design. `adr-graph` closes that gap by binding Architecture Decision Records (ADRs) directly to the code they govern, building a live DAG that tracks whether your implementation still matches your intent — at every commit.

---

## The Problem

When a Tech Lead makes an architectural decision, it travels through a chain:

```
TL's intent → ADR document → team member's interpretation → code
```

At every step, meaning is lost. The team member fills in gaps with assumptions. The AI coding assistant lacks context and modifies only part of the codebase. Six months later, no one knows why the auth module is structured the way it is, or which decisions are still in force.

This is not a documentation problem. It's a **semantic drift** problem.

`adr-graph` treats it as one.

---

## Core Concept

```
Git        records  →  what the code looks like
adr-graph  records  →  why the code is the way it is
```

The system maintains a **Semantic DAG** — a directed acyclic graph where:

- **ADR nodes** represent architecture decisions
- **Module nodes** represent code files and directories
- **Concept nodes** represent business domains (e.g. "user authentication", "payment")
- **Edges** represent relationships: `implements`, `depends_on`, `supersedes`, `affects`, `conflicts`

Every edge carries a certainty label:

| Certainty | Source | Meaning |
|-----------|--------|---------|
| `certain` | AST analysis | Deterministic, structural, always accurate |
| `inferred` | LLM analysis | Probabilistic, semantic, requires human confirmation |

The system **never mixes these two layers**. If a conclusion is structural, it is certain. If it requires understanding intent, it is explicitly marked as inferred and requires human sign-off before becoming part of the trusted graph.

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    adr-graph CLI                        │
│         init │ scan │ status │ impact │ viz             │
└───────────────────┬─────────────────────────────────────┘
                    │
        ┌───────────┴───────────┐
        │                       │
┌───────▼────────┐    ┌─────────▼────────┐
│   AST Layer    │    │   Semantic Layer  │
│  (Certain)     │    │   (Inferred)      │
│                │    │                   │
│ TypeScript     │    │  LLM reads:       │
│ Compiler API   │    │  - ADR text       │
│                │    │  - git diff       │
│ Extracts:      │    │  - local DAG      │
│ - imports      │    │    subgraph       │
│ - exports      │    │                   │
│ - call graph   │    │  Outputs:         │
│ - interfaces   │    │  - drift score    │
└───────┬────────┘    │  - binding status │
        │             │  - ADR suggestions│
        └──────┬──────┘
               │
    ┌──────────▼──────────┐
    │    Semantic DAG     │
    │  .adr-graph/dag.json│
    │  (versioned w/ git) │
    └─────────────────────┘
```

### Why the AST layer comes first

The LLM is only as good as the context it receives. By building a precise structural skeleton first — file dependencies, interface implementations, call chains — we give the LLM a compressed, accurate map of the codebase instead of raw source code. This makes semantic analysis both cheaper (fewer tokens) and more reliable (less hallucination).

### Why the DAG lives in `.adr-graph/`

The semantic history of your project should be versioned alongside the code. Every `git checkout` gives you not just the code at that point in time, but the full semantic state: which decisions were active, which bindings were aligned, which were already drifting.

---

## Installation

```bash
npm install -g adr-graph
```

Or use without installing:

```bash
npx adr-graph init
```

**Requirements:** Node.js 18+, TypeScript project (Python support in v0.3)

---

## Quick Start

```bash
# 1. Initialize — scans your project and builds the initial DAG
adr-graph init

# 2. Write your first ADR (or let adr-graph suggest one)
mkdir -p docs/adrs
# see ADR format below

# 3. Check binding health
adr-graph status

# 4. Before making a change, check impact
adr-graph impact src/auth/session.ts

# 5. Visualize the full graph
adr-graph viz
```

---

## ADR Format

`adr-graph` supports standard MADR and Nygard formats with an optional frontmatter block for explicit bindings.

```markdown
---
id: ADR-012
status: accepted
affects:
  - src/auth/
  - src/user/session.ts
supersedes: ADR-007
---

# Use JWT for session management

## Context
...

## Decision
...

## Consequences
...
```

**Frontmatter fields:**

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique identifier, e.g. `ADR-012` |
| `status` | enum | `proposed` \| `accepted` \| `deprecated` \| `superseded` |
| `affects` | string[] | File paths or directory prefixes this decision governs |
| `supersedes` | string | ID of the ADR this decision replaces |
| `conflicts` | string[] | IDs of ADRs that may conflict |

The `affects` field is the explicit binding layer — deterministic, no LLM required. LLM-assisted bindings are generated as suggestions and stored as `inferred` until you confirm them.

---

## Commands

### `adr-graph init`
Cold-start scan. Runs AST analysis across the entire project, parses all ADR files, and builds the initial Semantic DAG.

```bash
adr-graph init [--root <path>] [--adr-dir <path>]
```

Produces `.adr-graph/dag.json`. Add this file to git.

---

### `adr-graph scan`
Incremental re-scan after code changes. Preserves previously confirmed inferred edges. Run this after significant refactors or when adding new modules.

```bash
adr-graph scan [--root <path>]
```

---

### `adr-graph status`
Shows the current state of all ADR↔Module bindings, flagging any drift or broken bindings.

```bash
adr-graph status
```

Output example:
```
📊 adr-graph status

  Last updated: 2024-03-08T10:22:00Z
  Nodes:  47  (8 ADRs, 39 modules)
  Edges:  112  (98 certain ✅, 14 inferred ⚠️)
  ADR↔Module bindings: 23

🕐 Latest semantic snapshot (commit: a3f9c2):

  ✅ ADR-003 ↔ payment/checkout.ts     [aligned]
  ⚠️  ADR-012 ↔ auth/session.ts        [drifting — JWT expiry logic diverged, confidence 78%]
  🔴 ADR-007 ↔ user/profile.ts         [broken — superseded ADR still implemented here]
```

---

### `adr-graph impact <file-or-adr>`
Before making a change, understand what decisions govern a file and what other modules would be affected.

```bash
adr-graph impact src/auth/session.ts
adr-graph impact ADR-012
```

This is the **pre-flight check** for AI-assisted coding: run it before handing context to an AI assistant to ensure the AI has the relevant architectural constraints.

---

### `adr-graph viz`
Generates an interactive HTML visualization of the Semantic DAG. Opens in your browser.

```bash
adr-graph viz [--output graph.html]
```

Nodes are color-coded by status. Edges by certainty. Click any node to see its bindings, history, and linked source files.

---

## Git Hook Integration

To trigger semantic snapshot calculation on every commit:

```bash
adr-graph install-hook
```

This installs a `post-commit` hook that:
1. Extracts the diff from the latest commit
2. Identifies affected modules in the DAG
3. Sends the local subgraph + diff to the semantic layer
4. Writes a new `SemanticSnapshot` to `.adr-graph/dag.json`

The snapshot is committed on the next `git add .adr-graph/ && git commit`.

---

## For AI-Assisted Development

`adr-graph` is designed with AI coding workflows in mind. Before asking an AI assistant to modify a file, run:

```bash
adr-graph impact src/payments/processor.ts
```

This outputs the architectural constraints governing that file — which decisions are in force, what they require, and what other parts of the system would be affected by a change. Paste this output into your AI context window.

After the AI makes changes, run:

```bash
adr-graph scan && adr-graph status
```

Any binding that has moved to `drifting` or `broken` is a signal that the change either requires a new ADR or needs to be revisited.

---

## Project Structure

```
adr-graph/
├── src/
│   ├── cli/
│   │   └── index.ts          # CLI entry point
│   ├── core/
│   │   ├── ast/
│   │   │   └── scanner.ts    # TypeScript Compiler API scanner
│   │   ├── dag/
│   │   │   ├── adr-parser.ts # ADR markdown parser
│   │   │   ├── builder.ts    # DAG assembly
│   │   │   └── store.ts      # .adr-graph/dag.json persistence
│   │   └── semantic/
│   │       └── (LLM layer — v0.2)
│   └── types/
│       └── graph.ts          # Core type definitions
├── docs/
│   └── adrs/                 # This project's own ADRs
├── .adr-graph/
│   └── dag.json              # Generated — commit this
├── package.json
└── tsconfig.json
```

---

## Contributing

`adr-graph` is designed to be extended. The core extension points are:

- **Language adapters** — implement the `LanguageScanner` interface to add Python, Go, etc.
- **Semantic backends** — swap the LLM provider or implement custom drift detection logic
- **Visualization plugins** — alternative graph renderers

See [CONTRIBUTING.md](./CONTRIBUTING.md) for details.

---

## License

MIT
