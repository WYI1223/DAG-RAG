import { describe, it, expect } from "vitest";
import * as path from "path";
import { scanProject } from "../src/core/ast/scanner.js";

const PROJECT_ROOT = path.resolve(__dirname, "fixtures/sample-project");

describe("scanProject", () => {
  it("discovers all TypeScript modules", async () => {
    const result = await scanProject({ projectRoot: PROJECT_ROOT });
    const labels = result.modules.map((m) => m.label).sort();
    expect(labels).toEqual(["src/app.ts", "src/math.ts"]);
  });

  it("extracts exports correctly", async () => {
    const result = await scanProject({ projectRoot: PROJECT_ROOT });
    const math = result.modules.find((m) => m.label === "src/math.ts");
    expect(math).toBeDefined();
    expect(math!.exports.sort()).toEqual(["PI", "add"]);
  });

  it("extracts imports correctly", async () => {
    const result = await scanProject({ projectRoot: PROJECT_ROOT });
    const app = result.modules.find((m) => m.label === "src/app.ts");
    expect(app).toBeDefined();
    expect(app!.imports).toContain("./math.js");
  });

  it("creates depends_on edges for relative imports", async () => {
    const result = await scanProject({ projectRoot: PROJECT_ROOT });
    expect(result.edges.length).toBe(1);
    const edge = result.edges[0];
    expect(edge.kind).toBe("depends_on");
    expect(edge.certainty).toBe("certain");
    expect(edge.from).toBe("module:src/app.ts");
    expect(edge.to).toBe("module:src/math.ts");
  });

  it("sets language to typescript", async () => {
    const result = await scanProject({ projectRoot: PROJECT_ROOT });
    for (const mod of result.modules) {
      expect(mod.language).toBe("typescript");
    }
  });
});
