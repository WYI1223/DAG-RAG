// ============================================================
// ligare core types
// Every concept in the system maps to one of these types.
// ============================================================

// ------ Node types ------------------------------------------

export type NodeKind = "adr" | "module" | "concept";

export interface BaseNode {
  id: string;
  kind: NodeKind;
  label: string;
  createdAt: string; // ISO
}

/** An Architecture Decision Record */
export interface AdrNode extends BaseNode {
  kind: "adr";
  status: "proposed" | "accepted" | "deprecated" | "superseded";
  filePath: string; // path to the .md file
  title: string;
}

/** A code module — file or directory */
export interface ModuleNode extends BaseNode {
  kind: "module";
  filePath: string;
  language: "typescript" | "python" | "external" | "unknown";
  exports: string[];   // exported symbol names (from AST)
  imports: string[];   // imported module paths (from AST)
}

/** A business concept — extracted by LLM, confirmed by human */
export interface ConceptNode extends BaseNode {
  kind: "concept";
  description: string;
  confidence: "confirmed" | "inferred"; // inferred = LLM only, needs human confirm
}

export type GraphNode = AdrNode | ModuleNode | ConceptNode;

// ------ Edge types ------------------------------------------

export type EdgeKind =
  | "implements"   // ADR  → Module:  this code implements this decision
  | "affects"      // ADR  → Module/Concept: this decision constrains this code or area
  | "supersedes"   // ADR  → ADR:     this decision replaces another
  | "depends_on"   // Module → Module: structural import dependency (from AST, certain)
  | "belongs_to"   // Module → Concept: this code belongs to this business domain
  | "conflicts";   // ADR  → ADR:     potential conflict (LLM inferred)

export type EdgeCertainty = "certain" | "inferred";
// certain  = produced by AST analysis, deterministic
// inferred = produced by LLM, requires human confirmation

/** Three-tier relevance classification (ADR-021) */
export type Relevance = "related" | "possibly_related" | "unrelated";

export interface EdgeMetadata extends Record<string, unknown> {
  relevance?: Relevance;
  reason?: string;
}

export interface GraphEdge {
  id: string;
  from: string;       // node id
  to: string;         // node id
  kind: EdgeKind;
  certainty: EdgeCertainty;
  confidence?: number;  // 0-1, only when certainty === "inferred"
  confirmedAt?: string; // ISO, set when human confirms an inferred edge
  metadata?: EdgeMetadata;
}

// ------ Semantic snapshot -----------------------------------

/** State of a single (ADR, Module) binding at a specific commit */
export type BindingStatus = "aligned" | "drifting" | "broken" | "unverified";

export interface SemanticBinding {
  adrId: string;
  moduleId: string;
  status: BindingStatus;
  certainty: EdgeCertainty;
  relevance?: Relevance;
  confidence?: number;
  reason?: string;     // human-readable explanation of drift
  checkedAt: string;   // ISO
}

/** One semantic snapshot = one git commit */
export interface SemanticSnapshot {
  commitHash: string;
  timestamp: string;
  bindings: SemanticBinding[];
  driftCount: number;    // number of drifting/broken bindings
  summary?: string;
}

// ------ DAG -------------------------------------------------

export interface SemanticDAG {
  version: "1";
  projectRoot: string;
  createdAt: string;
  lastUpdatedAt: string;
  nodes: Record<string, GraphNode>;    // id → node
  edges: Record<string, GraphEdge>;   // id → edge
  snapshots: SemanticSnapshot[];       // ordered by time, latest last
}
