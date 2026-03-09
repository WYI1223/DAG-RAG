import { describe, it, expect, beforeAll } from "vitest";
import * as path from "path";
import { scanProject } from "../src/core/ast/scanner.js";
import { scanAdrDirectory, ParsedAdr } from "../src/core/dag/adr-parser.js";
import { buildDAG } from "../src/core/dag/builder.js";
import { SemanticDAG, ModuleNode } from "../src/types/graph.js";
import {
  filterRelevantModules,
  buildAnalysisPrompt,
  parseAnalysisResponse,
} from "../src/core/semantic/prompt.js";
import { analyzeSemantics } from "../src/core/semantic/analyzer.js";
import { SemanticClient, AnalyzeResult } from "../src/core/semantic/client.js";

function mockResponse(text: string): AnalyzeResult {
  return { text, inputTokens: 100, outputTokens: 50, durationMs: 500, truncated: false };
}

const PROJECT_ROOT = path.resolve(__dirname, "fixtures/sample-project");
const ADR_DIR = path.resolve(__dirname, "fixtures/sample-adrs");

let dag: SemanticDAG;
let adrs: ParsedAdr[];

beforeAll(async () => {
  const scan = await scanProject({ projectRoot: PROJECT_ROOT });
  adrs = scanAdrDirectory(ADR_DIR);
  dag = buildDAG(PROJECT_ROOT, scan, adrs);
});

// ---- prompt.ts tests ----------------------------------------

describe("parseAnalysisResponse", () => {
  it("parses valid JSON array", () => {
    const raw = JSON.stringify([
      { kind: "implements", from: "ADR-010", to: "mod:app.ts", reason: "directly implements the decision" },
    ]);
    const result = parseAnalysisResponse(raw);
    expect(result).toHaveLength(1);
    expect(result[0].kind).toBe("implements");
    expect(result[0].reason).toBe("directly implements the decision");
  });

  it("strips markdown code fences", () => {
    const raw = "```json\n[{\"kind\":\"affects\",\"from\":\"ADR-010\",\"to\":\"mod:app.ts\",\"reason\":\"test\"}]\n```";
    const result = parseAnalysisResponse(raw);
    expect(result).toHaveLength(1);
  });

  it("returns empty array for invalid JSON", () => {
    expect(parseAnalysisResponse("not json")).toEqual([]);
  });

  it("returns empty array for non-array JSON", () => {
    expect(parseAnalysisResponse('{"key":"value"}')).toEqual([]);
  });

  it("filters out entries with invalid kind", () => {
    const raw = JSON.stringify([
      { kind: "depends_on", from: "A", to: "B", reason: "wrong kind" },
    ]);
    expect(parseAnalysisResponse(raw)).toEqual([]);
  });

  it("filters out entries with missing fields", () => {
    const raw = JSON.stringify([
      { kind: "implements", from: "A" },
    ]);
    expect(parseAnalysisResponse(raw)).toEqual([]);
  });

  it("returns empty array for empty string", () => {
    expect(parseAnalysisResponse("")).toEqual([]);
  });

  it("returns empty array for empty JSON array", () => {
    expect(parseAnalysisResponse("[]")).toEqual([]);
  });
});

describe("filterRelevantModules", () => {
  it("excludes external modules", () => {
    // add a fake external module to dag
    const fakeExternal: ModuleNode = {
      id: "ext:lodash",
      kind: "module",
      label: "ext:lodash",
      filePath: "",
      language: "external",
      exports: [],
      imports: [],
      createdAt: new Date().toISOString(),
    };
    const allModules = [
      ...Object.values(dag.nodes).filter((n): n is ModuleNode => n.kind === "module"),
      fakeExternal,
    ];
    const filtered = filterRelevantModules(adrs[0], allModules);
    expect(filtered.every((m) => m.language !== "external")).toBe(true);
  });

  it("returns at most MAX_MODULES items", () => {
    const filtered = filterRelevantModules(adrs[0],
      Object.values(dag.nodes).filter((n): n is ModuleNode => n.kind === "module")
    );
    expect(filtered.length).toBeLessThanOrEqual(80);
  });
});

describe("buildAnalysisPrompt", () => {
  it("includes ADR id and title", () => {
    const modules = Object.values(dag.nodes).filter(
      (n): n is ModuleNode => n.kind === "module"
    );
    const prompt = buildAnalysisPrompt(adrs[0], modules, []);
    expect(prompt).toContain(adrs[0].node.id);
    expect(prompt).toContain(adrs[0].node.title);
  });

  it("includes module ids", () => {
    const modules = Object.values(dag.nodes).filter(
      (n): n is ModuleNode => n.kind === "module"
    );
    const prompt = buildAnalysisPrompt(adrs[0], modules, []);
    for (const m of modules) {
      expect(prompt).toContain(m.id);
    }
  });
});

// ---- analyzer.ts tests (with mock client) -------------------

describe("analyzeSemantics", () => {
  it("adds inferred edges from mock LLM response", async () => {
    const modules = Object.values(dag.nodes).filter(
      (n): n is ModuleNode => n.kind === "module"
    );
    const targetModule = modules[0];

    const mockClient: SemanticClient = {
      provider: "anthropic",
      async analyze() {
        return mockResponse(JSON.stringify([
          {
            kind: "affects",
            from: adrs[0].node.id,
            to: targetModule.id,
            reason: "ADR mentions math utilities which maps to this module",
          },
        ]));
      },
    };

    // make a copy to avoid mutating shared state
    const dagCopy: SemanticDAG = JSON.parse(JSON.stringify(dag));
    const edgesBefore = Object.keys(dagCopy.edges).length;
    const result = await analyzeSemantics(dagCopy, adrs, mockClient);

    expect(result.edgesAdded).toBeGreaterThanOrEqual(1);
    expect(Object.keys(dagCopy.edges).length).toBeGreaterThan(edgesBefore);

    // verify the new edge properties
    const newEdges = Object.values(dagCopy.edges).filter(
      (e) => e.certainty === "inferred"
    );
    expect(newEdges.length).toBeGreaterThanOrEqual(1);
    expect(newEdges[0].confidence).toBeUndefined();
    expect(newEdges[0].metadata?.reason).toBe("ADR mentions math utilities which maps to this module");
  });

  it("skips deprecated/superseded ADRs", async () => {
    const mockClient: SemanticClient = {
      provider: "anthropic",
      async analyze() {
        return mockResponse("[]");
      },
    };

    const dagCopy: SemanticDAG = JSON.parse(JSON.stringify(dag));
    // mark all ADRs as deprecated
    for (const node of Object.values(dagCopy.nodes)) {
      if (node.kind === "adr") {
        (node as any).status = "deprecated";
      }
    }
    const deprecatedAdrs = adrs.map((a) => ({
      ...a,
      node: { ...a.node, status: "deprecated" as const },
    }));

    const result = await analyzeSemantics(dagCopy, deprecatedAdrs, mockClient);
    expect(result.adrCount).toBe(0);
  });

  it("does not duplicate existing edges", async () => {
    const existingEdge = Object.values(dag.edges).find(
      (e) => e.kind === "implements"
    )!;

    const mockClient: SemanticClient = {
      provider: "anthropic",
      async analyze() {
        return mockResponse(JSON.stringify([
          {
            kind: existingEdge.kind,
            from: existingEdge.from,
            to: existingEdge.to,
            reason: "already exists",
          },
        ]));
      },
    };

    const dagCopy: SemanticDAG = JSON.parse(JSON.stringify(dag));
    const edgesBefore = Object.keys(dagCopy.edges).length;
    const result = await analyzeSemantics(dagCopy, adrs, mockClient);

    expect(result.edgesSkipped).toBeGreaterThanOrEqual(1);
    expect(Object.keys(dagCopy.edges).length).toBe(edgesBefore);
  });

  it("handles API errors gracefully", async () => {
    const mockClient: SemanticClient = {
      provider: "anthropic",
      async analyze() {
        throw new Error("API rate limit");
      },
    };

    const dagCopy: SemanticDAG = JSON.parse(JSON.stringify(dag));
    const result = await analyzeSemantics(dagCopy, adrs, mockClient);

    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain("API rate limit");
  });

  it("skips edges referencing non-existent nodes", async () => {
    const mockClient: SemanticClient = {
      provider: "anthropic",
      async analyze() {
        return mockResponse(JSON.stringify([
          {
            kind: "implements",
            from: adrs[0].node.id,
            to: "mod:nonexistent.ts",
            reason: "ghost module",
          },
        ]));
      },
    };

    const dagCopy: SemanticDAG = JSON.parse(JSON.stringify(dag));
    const edgesBefore = Object.keys(dagCopy.edges).length;
    const result = await analyzeSemantics(dagCopy, adrs, mockClient);

    expect(result.edgesSkipped).toBeGreaterThanOrEqual(1);
    expect(Object.keys(dagCopy.edges).length).toBe(edgesBefore);
  });
});
