import { describe, it, expect } from "vitest";
import * as path from "path";
import { scanProject } from "../src/core/ast/scanner.js";
import { scanAdrDirectory } from "../src/core/dag/adr-parser.js";
import { buildDAG, computeStats } from "../src/core/dag/builder.js";

const PROJECT_ROOT = path.resolve(__dirname, "fixtures/sample-project");
const ADR_DIR = path.resolve(__dirname, "fixtures/sample-adrs");

describe("buildDAG", () => {
  it("combines modules, ADRs, and edges into a DAG", async () => {
    const scan = await scanProject({ projectRoot: PROJECT_ROOT });
    const adrs = scanAdrDirectory(ADR_DIR);
    const dag = buildDAG(PROJECT_ROOT, scan, adrs);

    expect(dag.version).toBe("1");
    expect(dag.projectRoot).toBe(PROJECT_ROOT);
    expect(dag.snapshots).toEqual([]);

    // 2 modules + 2 ADRs = 4 nodes
    const nodes = Object.values(dag.nodes);
    expect(nodes).toHaveLength(4);
    expect(nodes.filter((n) => n.kind === "module")).toHaveLength(2);
    expect(nodes.filter((n) => n.kind === "adr")).toHaveLength(2);
  });

  it("creates implements edges from ADR affects field", async () => {
    const scan = await scanProject({ projectRoot: PROJECT_ROOT });
    const adrs = scanAdrDirectory(ADR_DIR);
    const dag = buildDAG(PROJECT_ROOT, scan, adrs);

    const implEdges = Object.values(dag.edges).filter(
      (e) => e.kind === "implements"
    );
    // ADR-010 affects "src/" which matches both modules
    expect(implEdges.length).toBe(2);
    for (const e of implEdges) {
      expect(e.from).toBe("ADR-010");
      expect(e.certainty).toBe("certain");
    }
  });

  it("creates supersedes edges", async () => {
    const scan = await scanProject({ projectRoot: PROJECT_ROOT });
    const adrs = scanAdrDirectory(ADR_DIR);
    const dag = buildDAG(PROJECT_ROOT, scan, adrs);

    const superEdges = Object.values(dag.edges).filter(
      (e) => e.kind === "supersedes"
    );
    expect(superEdges).toHaveLength(1);
    expect(superEdges[0].from).toBe("ADR-010");
    expect(superEdges[0].to).toBe("ADR-005");
  });
});

describe("computeStats", () => {
  it("computes correct statistics", async () => {
    const scan = await scanProject({ projectRoot: PROJECT_ROOT });
    const adrs = scanAdrDirectory(ADR_DIR);
    const dag = buildDAG(PROJECT_ROOT, scan, adrs);
    const stats = computeStats(dag);

    expect(stats.moduleCount).toBe(2);
    expect(stats.adrCount).toBe(2);
    expect(stats.conceptCount).toBe(0);
    expect(stats.dependsOnEdges).toBe(1);
    expect(stats.implementsEdges).toBe(2);
    expect(stats.certainEdges).toBe(stats.totalEdges); // all certain, no LLM yet
    expect(stats.inferredEdges).toBe(0);
  });
});
