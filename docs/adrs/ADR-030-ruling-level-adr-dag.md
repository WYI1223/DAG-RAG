# ADR-030: Ruling-Level ADR DAG

**Status:** Proposed
**Supersedes:** ADR-022 (code-centric batch check)
**Extends:** ADR-009 (LLM semantic layer), ADR-017 (drift check)

## Context

The project's name (ADR-DAG) implies a directed acyclic graph of ADR relationships, but the current implementation only models ADR→Module edges. The ADR→ADR evolution graph — the core "DAG" — is not captured.

### Problems with current approach

1. **No ADR lifecycle tracking.** We cannot distinguish active rulings from superseded ones. Check wastes tokens evaluating obsolete decisions.

2. **ADRs are not atomic.** A single ADR may contain multiple rulings (decisions). A later ADR may supersede only *some* of those rulings while leaving others active. Example:
   - ADR-004 has three rulings: (1) use D3.js, (2) CDN delivery, (3) flat grid layout
   - ADR-007 supersedes only ruling (3) → treemap replaces flat grid
   - Rulings (1) and (2) remain active

3. **Token waste.** Code-centric batching (ADR-022) sends all bound ADRs per module, including superseded ones, and relies on the LLM to infer evolution relationships at check time.

4. **Inaccuracy risk in ADR-centric checking.** If we switch to ADR-centric batching (one ADR per call), the LLM checking ADR-004 wouldn't see ADR-007's existence and would incorrectly flag the treemap code as "drifting" from the flat grid ruling.

## Decision

### 1. Model ADRs as collections of intent-based rulings

Each ADR contains one or more **rulings** — specific, testable architectural decisions. A ruling captures **intent** (the architectural constraint), not implementation details.

**Granularity principle**: a ruling is the right size when:
- It is **independently verifiable** against code
- It could be **independently superseded** by a future ADR without affecting sibling rulings
- It describes **what constraint the code must satisfy**, not how the code should look

Examples (using ADR-004):

| Too coarse | Too fine | Right granularity |
|-----------|---------|-------------------|
| "Use D3.js self-contained HTML visualization" (mixes 3 decisions) | "HTML uses `<script>` tag with d3js.org URL" (implementation detail) | "D3 is not an npm dependency; loaded at runtime" (intent) |

A ruling that says "D3 loaded at runtime, not bundled" is satisfied by CDN `<script>`, by inlining d3.min.js, or by any other approach that avoids an npm dependency. The check verifies whether the **intent** is met, not whether the implementation matches a specific pattern.

```typescript
interface Ruling {
  id: string;           // e.g. "ADR-004.R1"
  adrId: string;        // e.g. "ADR-004"
  intent: string;       // architectural constraint, e.g. "D3 is not an npm dependency; loaded at runtime"
  verifiable_by: string; // what to observe in code, e.g. "D3 absent from package.json dependencies; HTML loads D3 without build step"
  status: "active" | "superseded";
  supersededBy?: string; // ruling ID, e.g. "ADR-007.R1"
}
```

**`intent`** is the stable architectural constraint. **`verifiable_by`** describes what to look for in code without prescribing a specific implementation. The LLM check judges whether the intent is satisfied, not whether the code matches a particular pattern. This means:
- Code using unpkg CDN instead of d3js.org → **aligned** (same intent, different detail)
- Code vendoring D3 inline in HTML → **aligned** (no npm dependency, just a different delivery)
- Code adding `d3` to package.json → **drifting** (violates the intent)

#### Ruling extraction prompt

```
Extract rulings from this ADR. A ruling is a single, independently
testable architectural constraint (intent), not an implementation detail.

Guidelines:
- Capture WHAT the code must satisfy, not HOW it should be implemented
- If two decisions could be independently superseded in the future,
  they are separate rulings
- Ignore context/motivation — only extract the decisions themselves
- Each ruling must be verifiable by observing code, config, or output
- Typically 1-5 rulings per ADR

Output format per ruling:
- id: ADR-XXX.R<n>
- intent: one-sentence architectural constraint
- verifiable_by: what to observe in code (without prescribing implementation)
```

### 2. Build ADR→ADR edges at ruling level

ADR evolution edges connect rulings, not whole ADRs:

```typescript
interface AdrEvolutionEdge {
  from: string;   // ruling ID
  to: string;     // ruling ID
  kind: "supersedes" | "extends";
}
```

A DAG of rulings where:
- **supersedes**: the target ruling replaces the source ruling. Source becomes inactive.
- **extends**: the target ruling adds to the source ruling. Both remain active.

### 3. Rulings snapshot for incremental init

Instead of pairwise ADR comparison, maintain a **rulings snapshot** — a flat list of all currently active rulings. The snapshot is compact (~100 chars per ruling) and serves as context for processing each new ADR.

**Incremental processing (per ADR, chronological order):**

```
Input:  rulings snapshot (all active rulings so far) + new ADR full text
LLM task:
  1. Extract rulings from the new ADR
  2. Compare against snapshot — identify which existing rulings are superseded
Output: new rulings + supersession edges
Update: add new rulings to snapshot, mark superseded ones
```

**Cost model:**
- Snapshot size: ~80 rulings × ~100 chars ≈ 8k tokens for a 30-ADR project
- Each ADR call: ~8k snapshot + ~2k ADR text ≈ 10k tokens
- Full init (29 ADRs): ~290k tokens total (vs 1M+ for a single code-centric check today)
- Incremental (1 new ADR): ~10k tokens

**Key advantage over pairwise comparison:** the snapshot approach detects implicit supersession. Even if ADR-007 doesn't explicitly reference ADR-004, the LLM sees "flat grid layout" in the snapshot and recognizes that "treemap layout" supersedes it.

### 4. Two-phase architecture

**Phase 1 — init: Build the ADR DAG (no code)**

Input: all ADR files (processed chronologically).
Output: rulings + ADR→ADR evolution edges + rulings snapshot.

Steps:
1. Start with empty snapshot
2. For each ADR (chronological order):
   a. Send snapshot + ADR full text to LLM
   b. LLM extracts rulings and identifies superseded existing rulings
   c. Update snapshot: add new rulings, mark superseded ones
3. Store rulings, edges, and final snapshot in DAG

This phase reads zero source code.

**Phase 2 — check: Verify active rulings against code (ADR-centric)**

For each active ruling:
1. Identify bound modules (from existing ADR→Module edges, or inferred)
2. Send: ruling text + superseding context + module function signatures
3. LLM may call `read_code` to inspect specific functions
4. `submit_verdict` binds to function-level granularity

Superseded rulings are skipped entirely.

### 5. Scalability: pluggable retriever

For projects with < 100 ADRs, the flat snapshot fits easily in context. For large monorepos (300+ ADRs), the snapshot may exceed practical limits. The retriever interface allows swapping strategies:

```typescript
interface RulingRetriever {
  findRelated(adrText: string): Promise<Ruling[]>;
}

// v1: flat snapshot — returns all active rulings
class FlatRetriever implements RulingRetriever { ... }

// future: RAG retriever — embedding + vector search for top-K similar rulings
class RAGRetriever implements RulingRetriever { ... }
```

The core logic (ruling extraction, supersession detection, check) is retriever-agnostic. RAG support is deferred until real-world demand from large monorepo users justifies the added complexity (embedding model + vector store dependencies).

### 6. DAG schema additions

```typescript
// New node type in SemanticDAG
interface RulingNode {
  kind: "ruling";
  id: string;           // "ADR-004.R1"
  adrId: string;
  intent: string;
  verifiable_by: string;
  status: "active" | "superseded";
}

// New edge kinds
type EdgeKind =
  | "implements" | "affects"    // existing: ADR→Module
  | "supersedes" | "extends"    // new: Ruling→Ruling
  | "contains";                 // new: ADR→Ruling
```

### 7. The ADR DAG is a true DAG

ADRs are append-only (never modified), so:
- Edges always point forward in time (older → newer)
- No cycles are possible
- The graph may fork: one ruling can be partially superseded by multiple later rulings

## Consequences

### Positive
- **Token reduction**: skip superseded rulings in check → estimated 30-50% fewer bindings to evaluate
- **Accuracy**: no more relying on LLM to infer ADR evolution at check time
- **Foundation for ADR-centric check**: safe to check one ADR at a time since supersession context is explicit
- **The "DAG" in the project name finally exists** as a first-class data structure

### Negative
- **Init cost increases**: LLM must extract rulings and relationships (but only for cross-referencing ADR pairs)
- **Schema complexity**: ruling nodes and new edge kinds add to the DAG model
- **Migration**: existing DAGs need rebuilding (acceptable since `init` is re-runnable)

### Risks
- Ruling extraction quality depends on LLM accuracy. Mitigation: ruling extraction is reviewable in verbose output, and rulings are stored in DAG for human inspection.
- ADRs that implicitly supersede without cross-referencing are harder to detect. Mitigation: encourage explicit `Supersedes:` in ADR frontmatter.
