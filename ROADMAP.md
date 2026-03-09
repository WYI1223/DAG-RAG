# Roadmap

Current version: **v0.2 — Semantic Layer**

---

## v0.1 — Structural Foundation ✅ *delivered*

**Goal:** Prove the data model. Build the certain layer. Make the DAG real.

**Delivered:**
- Core type system (`SemanticDAG`, `GraphNode`, `GraphEdge`, `SemanticSnapshot`)
- TypeScript Compiler API scanner — extracts modules, exports, imports, `depends_on` edges
- ADR markdown parser — supports MADR and Nygard formats with frontmatter
- DAG builder — assembles structural graph from AST + ADR data
- `.adr-graph/dag.json` persistence, versioned with git
- CLI: `init`, `scan`, `status`

---

## v0.2 — Semantic Layer 🔄 *current*

**Goal:** Introduce LLM analysis on top of the structural skeleton. Make drift visible.

**Delivered:**
- Multi-provider LLM client (Anthropic direct, AWS Bedrock, Google Vertex, compatible APIs)
- `analyzeSemantics` — iterates ADRs, calls LLM, merges inferred edges into DAG
- Keyword-based module filtering to stay within token budget
- `inferred` edges with `reason` field, distinct from `certain` AST-derived edges
- `AnalysisProgress` callback with real-time token/s tracking
- Graceful degradation: structural analysis runs without API key
- Prompt optimization: import context in module lines, stricter `implements` definition (ADR-016)
- Interactive DAG visualization with D3.js force-directed + treemap layouts
- `impact` command — graph traversal to find affected ADRs and modules
- External package nodes (`ext:` prefix, excluded from semantic analysis)

---

## v0.3 — Git Integration & Value Validation 🔜

**Goal:** Connect the semantic layer to the git commit cycle. This is the version where the tool stops being a static analyzer and becomes a live architectural monitor — the point where its real value becomes demonstrable.

**Planned:**

**Git hook integration**
- `adr-graph install-hook` — installs a `post-commit` hook
- On each commit: extract diff → locate affected DAG nodes → query local subgraph → LLM evaluates binding status → write `SemanticSnapshot`
- Snapshots stored in `.adr-graph/dag.json`, committed alongside code
- Each snapshot anchored to a git commit hash — full semantic history, free

**Drift display in `status`**
- `certain` drift: structural — interface removed, import broken, superseded ADR still implemented
- `inferred` drift: semantic — LLM assessment with confidence score, pending human confirmation
- Output designed to be immediately actionable: file path, ADR id, reason, suggested next step

**Subgraph boundary heuristic**
- Prioritize nodes with direct ADR bindings over transitive neighbors
- Drop long-stable nodes (no changes in last N commits)
- Cap at token budget, never send full graph

---

## v0.4 — Cold Start & Multi-language 🔜

**Goal:** Make the tool usable on projects with no existing ADRs. Add Python support.

**Planned:**

**Reverse ADR generation**
- `adr-graph discover` — LLM analyzes structural DAG and suggests candidate ADRs
- Output: draft ADR files in `docs/adrs/` with frontmatter pre-filled
- User reviews and accepts/rejects each suggestion
- Incremental trust: accepted drafts start as `proposed`, gain confidence as bindings are validated over time

**Python language adapter**
- Tree-sitter based — establishes the `LanguageAdapter` interface for all future language support
- Extracts: imports, function and class definitions, `__all__` exports
- `depends_on` edges for relative imports, same certainty model as TypeScript

**Language adapter interface**
- Formal `LanguageAdapter` interface enabling community-built adapters for Go, Rust, Java, etc.

---

## v0.5 — Advanced Visualization & IDE Integration 🔜

**Goal:** Extend the existing visualization and bring it into the IDE.

**Planned:**

**`adr-graph viz` enhancements**
- Timeline slider: scrub through the project's semantic history commit by commit
- Concept node visualization (when concept nodes are implemented)
- Edge filtering by certainty and kind

**VS Code extension (alpha)**
- Inline annotations in source files: which ADRs govern this file
- Hover on a function: see if its module has any active drift warnings
- Status bar item: live drift count for the current workspace

---

## v0.6 — Collaboration & CI 🔜

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

**v0.3 (next — git integration):**
- `post-commit` hook implementation and cross-platform testing (macOS, Linux, Windows/WSL)
- `SemanticSnapshot` writer: diff → affected nodes → binding status → snapshot
- Drift detection and display in `status` output

**v0.4:**
- Python language adapter via Tree-sitter
- `LanguageAdapter` interface design
- Testing `discover` on projects with zero existing ADRs

**Ongoing:**
- Real-world project testing across languages and team sizes
- ADR format edge cases (non-standard headings, missing frontmatter)
- Performance profiling on large TypeScript projects (500+ files)
