# Roadmap

Current version: **v0.1 — Structural Foundation**

---

## v0.1 — Structural Foundation ✅ *current*

**Goal:** Prove the data model. Build the certain layer. Make the DAG real.

The first version establishes the core infrastructure: the type system, the AST scanner, the ADR parser, the DAG builder, and the CLI skeleton. Everything at this stage is deterministic — no LLM, no inference, no probability. If the graph says two things are connected, they are connected.

**Delivered:**
- Core type system (`SemanticDAG`, `GraphNode`, `GraphEdge`, `SemanticSnapshot`)
- TypeScript Compiler API scanner — extracts modules, exports, imports, `depends_on` edges
- ADR markdown parser — supports MADR and Nygard formats with frontmatter
- DAG builder — assembles structural graph from AST + ADR data
- `.adr-graph/dag.json` persistence, versioned with git
- CLI: `init`, `scan`, `status`

**What this version cannot do:**
- Detect semantic drift (no LLM yet)
- Handle projects with no existing ADRs (no reverse-generation yet)
- Visualize the graph
- Support languages other than TypeScript

---

## v0.2 — Semantic Layer 🔜 *next*

**Goal:** Introduce LLM analysis on top of the structural skeleton. Make drift visible.

This is the version where the system becomes genuinely useful. The LLM receives the structural DAG as compressed context — not raw source code — and uses it to reason about whether implementations still match their governing decisions.

**Planned:**

**Git hook integration**
- `adr-graph install-hook` — installs a `post-commit` hook
- On each commit: extract diff → locate affected DAG nodes → compute semantic binding status → write `SemanticSnapshot`
- Snapshots stored in `.adr-graph/dag.json`, committed with the code

**Semantic binding evaluation**
- LLM receives: ADR text + git diff + local DAG subgraph (1-2 hops from changed nodes)
- LLM outputs: binding status (`aligned` / `drifting` / `broken`), confidence score, plain-language reason
- Subgraph boundary heuristic: prioritize nodes with direct ADR bindings, then recently modified neighbors, drop long-stable nodes

**Drift display in `status`**
- `certain` drift: structural — interface removed, import path broken, superseded ADR still implemented
- `inferred` drift: semantic — LLM assessment with confidence score, pending human confirmation

**`adr-graph impact <file>`**
- Pre-flight check before AI-assisted coding
- Output: which ADRs govern this file, what constraints they impose, which other modules share those ADRs
- Designed to be pasted directly into an AI assistant's context window

**Technical decisions for v0.2:**
- LLM provider: Anthropic Claude API (claude-sonnet-4-20250514)
- API key via environment variable `ADR_GRAPH_ANTHROPIC_KEY`
- Token budget per analysis: ~4000 tokens input, 500 output
- Graceful degradation: if no API key, skip semantic layer, structural analysis still runs

---

## v0.3 — Cold Start & Python 🔜

**Goal:** Make the tool usable on projects with no existing ADRs. Add Python support.

The cold-start problem is real: most projects that would benefit from `adr-graph` have zero ADRs. Without a way to bootstrap from existing code, adoption requires significant upfront work.

**Planned:**

**Reverse ADR generation**
- `adr-graph discover` — LLM analyzes structural DAG and suggests candidate ADRs
- Output: draft ADR files in `docs/adrs/` with frontmatter pre-filled
- User reviews and accepts/rejects each suggestion
- Accepted drafts become `status: proposed` ADRs, rejected ones are discarded
- Incremental trust: newly discovered ADRs start unconfirmed, gain trust as humans validate bindings

**Python language adapter**
- Use Python's built-in `ast` module via a subprocess bridge or Tree-sitter
- Extract: module imports, function definitions, class definitions, `__all__` exports
- `depends_on` edges for relative imports, same certainty model as TypeScript

**Language adapter interface**
- Formal `LanguageScanner` interface so community adapters can be built for Go, Rust, Java, etc.

---

## v0.4 — Visualization & IDE Integration 🔜

**Goal:** Make the graph visible and queryable without the terminal.

**Planned:**

**`adr-graph viz`**
- Generates a self-contained HTML file with an interactive DAG
- Node types visually distinct (ADR / Module / Concept)
- Edge certainty visually distinct (solid = certain, dashed = inferred)
- Click any node: see its full binding history, linked source files, governing ADRs
- Timeline slider: scrub through the project's semantic history commit by commit

**VS Code extension (alpha)**
- Inline annotations in source files: which ADRs govern this file
- Hover on a function: see if its module has any active drift warnings
- Status bar item: live drift count for the current workspace

---

## v0.5 — Collaboration & CI 🔜

**Goal:** Make architectural drift a team-level signal, not just a local one.

**Planned:**

**GitHub Actions integration**
- `adr-graph/action` — runs `scan` + semantic analysis on every PR
- PR comment: "This PR affects 3 ADR bindings. ADR-012 binding status: drifting (confidence 81%)"
- Configurable: warn-only or blocking check

**GitHub Bot**
- Listens for commits to `docs/adrs/` — automatically runs impact analysis on new/modified ADRs
- Comments on the PR with affected modules and potential conflicts with existing decisions

**Trend reporting**
- `adr-graph report` — generates a markdown summary of architectural health over time
- Metrics: drift count over time, most contested modules, ADRs with highest churn

---

## v1.0 — Stable Public API 🔜

**Goal:** Commit to a stable interface. Ready for production use in teams.

**Criteria for v1.0:**
- Stable CLI interface (no breaking changes without major version bump)
- Stable DAG JSON schema with migration tooling
- TypeScript and Python fully supported
- Git hook and GitHub Actions integration production-tested
- VS Code extension out of alpha
- Public documentation site
- Semantic versioning enforced

---

## Unscheduled / Under Consideration

These are ideas that have been discussed but not yet scheduled. They require more validation before committing engineering resources.

**Concept node generation** — LLM-assisted business domain extraction. Adds a third node type to the graph representing business concepts ("user authentication", "payment processing"), with modules assigned to domains. Useful for understanding architectural boundaries but adds significant complexity to the semantic layer.

**Conflict detection between ADRs** — When a new ADR is drafted, automatically check it against existing accepted ADRs for potential conflicts. Requires modeling ADR semantics as constraints, not just text.

**Multi-repo support** — For organizations with microservices spread across multiple repositories, the DAG needs to span repo boundaries. Architectural decisions often govern cross-service contracts (API shapes, event schemas) that are split across codebases.

**Local model support** — Allow running the semantic layer against a local LLM (Ollama, llama.cpp) for teams that cannot send code to external APIs. The quality tradeoff must be clearly documented.

**ADR templates and linting** — Guide teams toward writing ADRs that contain enough information for reliable semantic binding. Flag ADRs that are too vague to be meaningfully bound to code.

---

## Contribution Priorities by Phase

If you want to contribute, here is where effort would have the most impact right now:

**v0.2 (active):**
- Git hook implementation and testing across different OS environments
- Prompt engineering for the semantic binding evaluator
- Testing the subgraph boundary heuristic on real-world projects

**v0.3:**
- Python language adapter
- Language adapter interface design
- Testing `discover` on projects of varying sizes and styles

**Ongoing:**
- Real-world project testing (bring your own codebase)
- ADR format edge cases (unusual frontmatter, non-standard heading structures)
- Performance profiling on large TypeScript projects (1000+ files)
