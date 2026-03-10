# Roadmap

Current version: **v0.3 — Git Integration & CI**

---

## v0.1 — Structural Foundation ✅ *delivered*

**Goal:** Prove the data model. Build the certain layer. Make the DAG real.

**Delivered:**
- Core type system (`SemanticDAG`, `GraphNode`, `GraphEdge`, `SemanticSnapshot`)
- TypeScript Compiler API scanner — extracts modules, exports, imports, `depends_on` edges
- ADR markdown parser — supports MADR and Nygard formats with frontmatter
- DAG builder — assembles structural graph from AST + ADR data
- `.ligare/dag.json` persistence, versioned with git
- CLI: `init`, `scan`, `status`

---

## v0.2 — Semantic Layer ✅ *delivered*

**Goal:** Introduce LLM analysis on top of the structural skeleton. Make drift visible.

**Delivered:**

*Semantic edge inference*
- Multi-provider LLM client (Anthropic direct, AWS Bedrock, Google Vertex, compatible APIs)
- `analyzeSemantics` — iterates ADRs, calls LLM, merges inferred edges into DAG
- Keyword-based module filtering to stay within token budget
- `inferred` edges with `reason` field, distinct from `certain` AST-derived edges
- `AnalysisProgress` callback with real-time token/s tracking
- Graceful degradation: structural analysis runs without API key
- Prompt optimization: import context in module lines, stricter `implements` definition (ADR-016)

*Drift detection (`check` command)*
- `ligare check` — LLM evaluates each ADR↔module binding for alignment
- Code-centric batch checking: one LLM call per module with all governing ADRs, enabling ADR evolution context (ADR-022)
- Tool-use based structured output: `submit_verdict` tool eliminates JSON parsing failures (ADR-023)
- On-demand code reading: `read_code` tool lets LLM inspect collapsed code blocks in large files (ADR-024)
- ADR-aware code summarization with IDF-weighted block selection (ADR-018)
- Three-tier relevance classification: related / possibly_related / unrelated (ADR-021)
- Check-time relevance filtering with `--all` override (ADR-019)
- Frontmatter `implements` vs `affects` edge split (ADR-020)
- Typed `EdgeMetadata` and `SemanticBinding.relevance` fields in core types

*Visualization & analysis*
- Interactive DAG visualization with D3.js force-directed + treemap layouts
- `impact` command — graph traversal to find affected ADRs and modules
- External package nodes (`ext:` prefix, excluded from semantic analysis)

---

## v0.3 — Git Integration & CI 🔄 *current*

**Goal:** Connect the semantic layer to the git commit cycle. Make drift a continuous signal, not a manual check.

**Delivered:**

**Git-aware incremental check** ✅
- `ligare check --changed` — only check bindings affected by recent git changes (ADR-025)
- Git diff extraction: committed + staged + unstaged changes, ADR change propagation
- Ref resolution: user-specified `--ref` > last snapshot commit > HEAD~1

**`SemanticSnapshot` writer** ✅
- After each `check`, write a snapshot anchored to the current commit hash
- Track drift count over time — enables trend analysis
- Snapshots stored in `.ligare/dag.json`, committed alongside code

**Drift display in `status`** ✅
- Show latest check results inline: aligned / drifting / broken per module
- Output designed to be immediately actionable: file path, ADR id, reason

**GitHub Actions integration**
- `ligare/action` — runs `check --changed` on every PR
- PR comment summarizing binding status changes
- Configurable: warn-only or blocking check

**Project rename** ✅
- Renamed to `ligare` (npm package published)

---

## v0.4 — Cold Start & Multi-language 🔜


**Goal:** Make the tool usable on projects with no existing ADRs. Add Python support.

**Planned:**

**Reverse ADR generation**
- `ligare discover` — LLM analyzes structural DAG and suggests candidate ADRs
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

**`ligare viz` enhancements**
- Timeline slider: scrub through the project's semantic history commit by commit
- Concept node visualization (when concept nodes are implemented)
- Edge filtering by certainty and kind

**VS Code extension (alpha)**
- Inline annotations in source files: which ADRs govern this file
- Hover on a function: see if its module has any active drift warnings
- Status bar item: live drift count for the current workspace

---

## v0.6 — Collaboration & Reporting 🔜

**Goal:** Make architectural drift a team-level signal, not just a local one.

**Planned:**

**GitHub Bot**
- Listens for commits to `docs/adrs/` — automatically runs impact analysis on new/modified ADRs
- Comments on the PR with affected modules and potential conflicts with existing decisions

**Trend reporting**
- `ligare report` — generates a markdown summary of architectural health over time
- Metrics: drift count over time, most contested modules, ADRs with highest churn
- Powered by `SemanticSnapshot` history from v0.3

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

**v0.3 (current — git integration & CI):**
- GitHub Actions integration: PR-level drift reports

**v0.4:**
- Python language adapter via Tree-sitter
- `LanguageAdapter` interface design
- Testing `discover` on projects with zero existing ADRs

**Ongoing:**
- Real-world project testing across languages and team sizes
- ADR format edge cases (non-standard headings, missing frontmatter)
- Performance profiling on large TypeScript projects (500+ files)
