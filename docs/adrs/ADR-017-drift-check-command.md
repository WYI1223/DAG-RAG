---
id: ADR-017
status: accepted
affects:
  - src/core/semantic/checker.ts
  - src/core/semantic/check-prompt.ts
  - src/cli/index.ts
---

# Lightweight drift detection via `adr-graph check`

## Context

The core promise of adr-graph is detecting when code diverges from the decisions that govern it. After v0.2 delivered semantic edge inference, the system can answer "which ADRs govern this file?" but cannot yet answer "is the code still following this ADR?"

The full v0.3 plan calls for git hook integration with SemanticSnapshots on every commit. However, drift detection is the single most differentiating feature — it should be available before the full git integration is ready.

The semantic inference prompt (ADR-016) only sends module metadata (exports, imports). This is sufficient for discovering relationships but insufficient for evaluating compliance. Drift evaluation requires seeing actual source code.

## Decision

Introduce an `adr-graph check` command that performs on-demand drift detection without requiring git hooks.

**Mechanism:**
1. Read the DAG and enumerate all ADR→Module bindings (both `certain` from frontmatter and `inferred` from LLM)
2. For each binding, build a prompt containing:
   - Full ADR text
   - Module's actual source code (truncated to token budget)
   - The binding relationship type (implements / affects)
   - Existing edges from the DAG for context
3. LLM evaluates binding status: `aligned`, `drifting`, or `broken`
4. Results displayed in terminal with actionable output

**Interface:**
```bash
adr-graph check              # check all bindings
adr-graph check ADR-001      # check one ADR's bindings
adr-graph check src/foo.ts   # check one module's bindings
```

**Output format:**
Each binding reports a status with evidence:
- `aligned` — code faithfully implements/respects the decision
- `drifting` — partial divergence, the intent is recognizable but details have shifted
- `broken` — the code contradicts or ignores the decision

## Consequences

- Positive: Delivers the core differentiating feature (drift detection) without waiting for full git integration
- Positive: Sends actual source code to LLM, producing more accurate evaluations than metadata-only inference
- Positive: Output can be piped to AI assistants as architectural context
- Negative: Requires LLM API call per binding — slower and costlier than structural checks
- Negative: Token budget limits how much code can be sent per module; very large files may need truncation
- Future: Git hook integration (v0.3) can reuse the checker for incremental drift evaluation on each commit
