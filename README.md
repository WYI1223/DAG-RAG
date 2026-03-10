# ligare

> **Semantic Git** — a layer above Git that records not just *what* changed, but *why*.

Most codebases accumulate a silent gap between intent and implementation. Architecture decisions get written down (if at all) in documents that no one reads, while the code drifts quietly away from the original design. `ligare` closes that gap by binding Architecture Decision Records (ADRs) directly to the code they govern, building a live DAG that tracks whether your implementation still matches your intent — at every commit.

---

## The Problem

Documentation accumulates. Decisions get written down in ADRs, Confluence pages, design docs, Slack threads. The codebase keeps moving. At some point — gradually, invisibly — the documents stop describing what the code actually does. No one notices until someone breaks something that "shouldn't be breakable," or spends a day reading code to understand a constraint that should have been one sentence.

This is not a discipline problem. It is a structural problem: documentation and code are separate artifacts with separate maintenance cycles, and under pressure the documentation loses.

The only sustainable answer is to make ADRs the **single source of truth** — not alongside other documentation, but instead of it. ADRs are small enough to maintain because they only record decisions, not implementations. The code records the implementation. Together they are complete.

The missing piece is the binding between them: something that makes the gap visible the moment it opens, so it never silently accumulates.

```
TL's intent → ADR → team member's interpretation → code
AI assistant → locally reasonable change → globally wrong result
```

At every step, meaning is lost. `ligare` closes that gap by binding ADRs directly to the code they govern, and detecting the moment implementation diverges from intent.

This is not a documentation problem. It's a **semantic drift** problem.

`ligare` treats it as one.

---

## Core Concept

```
Git        records  →  what the code looks like
ligare  records  →  why the code is the way it is
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
│                    ligare CLI                        │
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
    │  .ligare/dag.json│
    │  (versioned w/ git) │
    └─────────────────────┘
```

### Why the AST layer comes first

The LLM is only as good as the context it receives. By building a precise structural skeleton first — file dependencies, interface implementations, call chains — we give the LLM a compressed, accurate map of the codebase instead of raw source code. This makes semantic analysis both cheaper (fewer tokens) and more reliable (less hallucination).

### Why the DAG lives in `.ligare/`

The semantic history of your project should be versioned alongside the code. Every `git checkout` gives you not just the code at that point in time, but the full semantic state: which decisions were active, which bindings were aligned, which were already drifting.

---

## Installation

```bash
npm install -g ligare
```

Or use without installing:

```bash
npx ligare init
```

**Requirements:** Node.js 18+, TypeScript project (Python support planned for v0.4)

---

## Quick Start

```bash
# 1. Initialize — scans your project and builds the initial DAG
ligare init

# 2. Write your first ADR (or let ligare suggest one)
mkdir -p docs/adrs
# see ADR format below

# 3. Check binding health
ligare status

# 4. Before making a change, check impact
ligare impact src/auth/session.ts

# 5. Visualize the full graph
ligare viz
```

---

## ADR Format

`ligare` supports standard MADR and Nygard formats with an optional frontmatter block for explicit bindings.

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

### `ligare init`
Cold-start scan. Runs AST analysis across the entire project, parses all ADR files, and builds the initial Semantic DAG.

```bash
ligare init [--root <path>] [--adr-dir <path>]
```

Produces `.ligare/dag.json`. Add this file to git.

---

### `ligare scan`
Incremental re-scan after code changes. Preserves previously confirmed inferred edges. Run this after significant refactors or when adding new modules.

```bash
ligare scan [--root <path>]
```

---

### `ligare status`
Shows the current state of all ADR↔Module bindings, flagging any drift or broken bindings.

```bash
ligare status
```

Output example:
```
📊 ligare status

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

### `ligare impact <file-or-adr>`
Before making a change, understand what decisions govern a file and what other modules would be affected.

```bash
ligare impact src/auth/session.ts
ligare impact ADR-012
```

This is the **pre-flight check** for AI-assisted coding: run it before handing context to an AI assistant to ensure the AI has the relevant architectural constraints.

---

### `ligare viz`
Generates an interactive HTML visualization of the Semantic DAG. Opens in your browser.

```bash
ligare viz [--output graph.html]
```

Nodes are color-coded by status. Edges by certainty. Click any node to see its bindings, history, and linked source files.

---

## Git Hook Integration

To trigger semantic snapshot calculation on every commit:

```bash
ligare install-hook
```

This installs a `post-commit` hook that:
1. Extracts the diff from the latest commit
2. Identifies affected modules in the DAG
3. Sends the local subgraph + diff to the semantic layer
4. Writes a new `SemanticSnapshot` to `.ligare/dag.json`

The snapshot is committed on the next `git add .ligare/ && git commit`.

---

## For AI-Assisted Development

`ligare` is designed with AI coding workflows in mind. Before asking an AI assistant to modify a file, run:

```bash
ligare impact src/payments/processor.ts
```

This outputs the architectural constraints governing that file — which decisions are in force, what they require, and what other parts of the system would be affected by a change. Paste this output into your AI context window.

After the AI makes changes, run:

```bash
ligare scan && ligare status
```

Any binding that has moved to `drifting` or `broken` is a signal that the change either requires a new ADR or needs to be revisited.

---

## Project Structure

```
ligare/
├── src/
│   ├── cli/
│   │   └── index.ts          # CLI entry point
│   ├── core/
│   │   ├── ast/
│   │   │   └── scanner.ts    # TypeScript Compiler API scanner
│   │   ├── dag/
│   │   │   ├── adr-parser.ts # ADR markdown parser
│   │   │   ├── builder.ts    # DAG assembly
│   │   │   └── store.ts      # .ligare/dag.json persistence
│   │   └── semantic/
│   │       ├── analyzer.ts  # ADR↔Module semantic inference orchestrator
│   │       ├── client.ts    # Multi-provider LLM client
│   │       └── prompt.ts    # Prompt construction and response parsing
│   └── types/
│       └── graph.ts          # Core type definitions
├── docs/
│   └── adrs/                 # This project's own ADRs
├── .ligare/
│   └── dag.json              # Generated — commit this
├── package.json
└── tsconfig.json
```

---

## Contributing

`ligare` is designed to be extended. The core extension points are:

- **Language adapters** — implement the `LanguageScanner` interface to add Python, Go, etc.
- **Semantic backends** — swap the LLM provider or implement custom drift detection logic
- **Visualization plugins** — alternative graph renderers

See [CONTRIBUTING.md](./CONTRIBUTING.md) for details.

---

## License

MIT
