import { describe, it, expect, beforeAll } from "vitest";
import * as path from "path";
import { scanProject } from "../src/core/ast/scanner.js";
import { scanAdrDirectory } from "../src/core/dag/adr-parser.js";
import { buildDAG } from "../src/core/dag/builder.js";
import { analyzeImpact, resolveTarget } from "../src/core/dag/impact.js";
import { SemanticDAG } from "../src/types/graph.js";

const PROJECT_ROOT = path.resolve(__dirname, "fixtures/sample-project");
const ADR_DIR = path.resolve(__dirname, "fixtures/sample-adrs");

let dag: SemanticDAG;

beforeAll(async () => {
  const scan = await scanProject({ projectRoot: PROJECT_ROOT });
  const adrs = scanAdrDirectory(ADR_DIR);
  dag = buildDAG(PROJECT_ROOT, scan, adrs);
});

describe("resolveTarget", () => {
  it("resolves by ADR ID", () => {
    const node = resolveTarget("ADR-010", dag);
    expect(node).not.toBeNull();
    expect(node!.kind).toBe("adr");
    expect(node!.id).toBe("ADR-010");
  });

  it("resolves by relative file path", () => {
    const node = resolveTarget("src/math.ts", dag);
    expect(node).not.toBeNull();
    expect(node!.kind).toBe("module");
    expect(node!.id).toBe("module:src/math.ts");
  });

  it("returns null for unknown target", () => {
    expect(resolveTarget("nonexistent.ts", dag)).toBeNull();
  });
});

describe("analyzeImpact — module", () => {
  it("finds governing ADRs for a module", () => {
    const report = analyzeImpact("src/app.ts", dag);
    expect(report).not.toBeNull();
    expect(report!.kind).toBe("module");
    if (report!.kind !== "module") return;

    const adrIds = report.governingAdrs.map((a) => a.id);
    expect(adrIds).toContain("ADR-010");
  });

  it("finds dependencies", () => {
    const report = analyzeImpact("src/app.ts", dag);
    if (report?.kind !== "module") return;

    const depLabels = report.dependsOn.map((m) => m.label);
    expect(depLabels).toContain("src/math.ts");
  });

  it("finds reverse dependencies", () => {
    const report = analyzeImpact("src/math.ts", dag);
    if (report?.kind !== "module") return;

    const depByLabels = report.dependedBy.map((m) => m.label);
    expect(depByLabels).toContain("src/app.ts");
  });

  it("finds sibling modules", () => {
    const report = analyzeImpact("src/app.ts", dag);
    if (report?.kind !== "module") return;

    const sibLabels = report.siblings.map((m) => m.label);
    expect(sibLabels).toContain("src/math.ts");
  });
});

describe("analyzeImpact — ADR", () => {
  it("finds implementing modules", () => {
    const report = analyzeImpact("ADR-010", dag);
    expect(report).not.toBeNull();
    expect(report!.kind).toBe("adr");
    if (report!.kind !== "adr") return;

    const labels = report.implementedBy.map((m) => m.label).sort();
    expect(labels).toEqual(["src/app.ts", "src/math.ts"]);
  });

  it("finds supersedes relationships", () => {
    const report = analyzeImpact("ADR-010", dag);
    if (report?.kind !== "adr") return;

    expect(report.supersedes).toHaveLength(0);
  });

  it("finds dependency subgraph among affected modules", () => {
    const report = analyzeImpact("ADR-010", dag);
    if (report?.kind !== "adr") return;

    expect(report.dependencySubgraph.length).toBe(1);
    expect(report.dependencySubgraph[0].from).toBe("module:src/app.ts");
    expect(report.dependencySubgraph[0].to).toBe("module:src/math.ts");
  });

  it("returns null for unknown target", () => {
    expect(analyzeImpact("ADR-999", dag)).toBeNull();
  });
});
