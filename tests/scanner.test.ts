import { describe, it, expect, beforeAll } from "vitest";
import * as path from "path";
import { scanProject, ScanResult } from "../src/core/ast/scanner.js";

const PROJECT_ROOT = path.resolve(__dirname, "fixtures/sample-project");

let result: ScanResult;

beforeAll(async () => {
  result = await scanProject({ projectRoot: PROJECT_ROOT });
});

describe("scanProject", () => {
  it("discovers all TypeScript modules", () => {
    const labels = result.modules.map((m) => m.label).sort();
    expect(labels).toEqual(["src/app.ts", "src/math.ts"]);
  });

  it("extracts exports correctly", () => {
    const math = result.modules.find((m) => m.label === "src/math.ts");
    expect(math).toBeDefined();
    expect(math!.exports.sort()).toEqual(["PI", "add"]);
  });

  it("extracts imports correctly", () => {
    const app = result.modules.find((m) => m.label === "src/app.ts");
    expect(app).toBeDefined();
    expect(app!.imports).toContain("./math.js");
  });

  it("creates depends_on edges for relative imports", () => {
    expect(result.edges.length).toBe(1);
    const edge = result.edges[0];
    expect(edge.kind).toBe("depends_on");
    expect(edge.certainty).toBe("certain");
    expect(edge.from).toBe("module:src/app.ts");
    expect(edge.to).toBe("module:src/math.ts");
  });

  it("sets language to typescript", () => {
    for (const mod of result.modules) {
      expect(mod.language).toBe("typescript");
    }
  });
});
