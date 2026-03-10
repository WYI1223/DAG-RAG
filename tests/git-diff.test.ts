import { describe, it, expect } from "vitest";
import {
  resolveGitRef,
  getChangedFiles,
  mapChangedFilesToNodes,
  expandAdrChangesToModules,
  getAffectedModules,
  GitExecutor,
} from "../src/core/git/diff.js";
import { SemanticDAG } from "../src/types/graph.js";

// ---- mock DAG -----------------------------------------------

function makeMockDAG(): SemanticDAG {
  return {
    version: "1",
    projectRoot: "/project",
    createdAt: "2025-01-01T00:00:00Z",
    lastUpdatedAt: "2025-01-01T00:00:00Z",
    nodes: {
      "module:src/core/ast/scanner.ts": {
        id: "module:src/core/ast/scanner.ts",
        kind: "module",
        label: "scanner.ts",
        createdAt: "2025-01-01T00:00:00Z",
        filePath: "/project/src/core/ast/scanner.ts",
        language: "typescript",
        exports: ["scanProject"],
        imports: [],
      },
      "module:src/cli/index.ts": {
        id: "module:src/cli/index.ts",
        kind: "module",
        label: "index.ts",
        createdAt: "2025-01-01T00:00:00Z",
        filePath: "/project/src/cli/index.ts",
        language: "typescript",
        exports: [],
        imports: [],
      },
      "module:src/core/viz/html-generator.ts": {
        id: "module:src/core/viz/html-generator.ts",
        kind: "module",
        label: "html-generator.ts",
        createdAt: "2025-01-01T00:00:00Z",
        filePath: "/project/src/core/viz/html-generator.ts",
        language: "typescript",
        exports: ["generateHTML"],
        imports: [],
      },
      "ext:chalk": {
        id: "ext:chalk",
        kind: "module",
        label: "chalk",
        createdAt: "2025-01-01T00:00:00Z",
        filePath: "chalk",
        language: "external",
        exports: [],
        imports: [],
      },
      "ADR-001": {
        id: "ADR-001",
        kind: "adr",
        label: "ADR-001",
        createdAt: "2025-01-01T00:00:00Z",
        status: "accepted",
        filePath: "/project/docs/adrs/ADR-001-typescript-compiler-api.md",
        title: "Use TypeScript Compiler API",
      },
      "ADR-004": {
        id: "ADR-004",
        kind: "adr",
        label: "ADR-004",
        createdAt: "2025-01-01T00:00:00Z",
        status: "accepted",
        filePath: "/project/docs/adrs/ADR-004-html-viz.md",
        title: "Self-contained HTML visualization",
      },
    },
    edges: {
      "implements:ADR-001→module:src/core/ast/scanner.ts": {
        id: "implements:ADR-001→module:src/core/ast/scanner.ts",
        from: "ADR-001",
        to: "module:src/core/ast/scanner.ts",
        kind: "implements",
        certainty: "inferred",
      },
      "affects:ADR-001→module:src/cli/index.ts": {
        id: "affects:ADR-001→module:src/cli/index.ts",
        from: "ADR-001",
        to: "module:src/cli/index.ts",
        kind: "affects",
        certainty: "inferred",
      },
      "implements:ADR-004→module:src/core/viz/html-generator.ts": {
        id: "implements:ADR-004→module:src/core/viz/html-generator.ts",
        from: "ADR-004",
        to: "module:src/core/viz/html-generator.ts",
        kind: "implements",
        certainty: "inferred",
      },
      "depends_on:module:src/cli/index.ts→module:src/core/ast/scanner.ts": {
        id: "depends_on:module:src/cli/index.ts→module:src/core/ast/scanner.ts",
        from: "module:src/cli/index.ts",
        to: "module:src/core/ast/scanner.ts",
        kind: "depends_on",
        certainty: "certain",
      },
    },
    snapshots: [],
  };
}

// ---- mock git executor --------------------------------------

function createMockExecutor(
  responses: Record<string, string>,
): GitExecutor {
  return (cmd: string, _cwd: string) => {
    for (const [pattern, response] of Object.entries(responses)) {
      if (cmd.includes(pattern)) return response;
    }
    throw new Error(`Mock: no response for command: ${cmd}`);
  };
}

// ---- tests --------------------------------------------------

describe("resolveGitRef", () => {
  const exec = createMockExecutor({
    "rev-parse --verify": "abc123",
  });

  it("uses user-specified ref when provided", () => {
    const result = resolveGitRef("/project", { userRef: "main", exec });
    expect(result.ref).toBe("main");
    expect(result.source).toBe("user");
  });

  it("uses snapshot commit hash when no user ref", () => {
    const result = resolveGitRef("/project", {
      snapshotCommitHash: "abc123",
      exec,
    });
    expect(result.ref).toBe("abc123");
    expect(result.source).toBe("snapshot");
  });

  it("falls back to HEAD~1 when no snapshot", () => {
    const execFail = createMockExecutor({});
    // resolveGitRef with no userRef and no snapshot should return HEAD~1
    const result = resolveGitRef("/project", { exec: execFail });
    expect(result.ref).toBe("HEAD~1");
    expect(result.source).toBe("fallback");
  });

  it("throws on invalid user ref", () => {
    const execFail: GitExecutor = () => {
      throw new Error("not a valid ref");
    };
    expect(() =>
      resolveGitRef("/project", { userRef: "bad-ref", exec: execFail }),
    ).toThrow("Invalid git ref: bad-ref");
  });

  it("falls through if snapshot commit is invalid", () => {
    const execFail: GitExecutor = () => {
      throw new Error("not a valid ref");
    };
    const result = resolveGitRef("/project", {
      snapshotCommitHash: "rebased-away",
      exec: execFail,
    });
    expect(result.ref).toBe("HEAD~1");
    expect(result.source).toBe("fallback");
  });
});

describe("getChangedFiles", () => {
  it("merges committed, staged, and unstaged changes", () => {
    const exec = createMockExecutor({
      "diff --name-only HEAD~1 HEAD": "src/a.ts\nsrc/b.ts",
      "diff --name-only --cached": "src/b.ts\nsrc/c.ts",
      "diff --name-only": "src/d.ts",
    });

    const files = getChangedFiles("/project", "HEAD~1", exec);
    expect(files).toEqual([
      "src/a.ts",
      "src/b.ts",
      "src/c.ts",
      "src/d.ts",
    ]);
  });

  it("deduplicates files across sources", () => {
    const exec = createMockExecutor({
      "diff --name-only HEAD~1 HEAD": "src/a.ts",
      "diff --name-only --cached": "src/a.ts",
      "diff --name-only": "src/a.ts",
    });

    const files = getChangedFiles("/project", "HEAD~1", exec);
    expect(files).toEqual(["src/a.ts"]);
  });

  it("handles empty diff gracefully", () => {
    const exec = createMockExecutor({
      "diff --name-only HEAD~1 HEAD": "",
      "diff --name-only --cached": "",
      "diff --name-only": "",
    });

    const files = getChangedFiles("/project", "HEAD~1", exec);
    expect(files).toEqual([]);
  });

  it("normalizes backslashes to forward slashes", () => {
    const exec = createMockExecutor({
      "diff --name-only HEAD~1 HEAD": "src\\core\\a.ts",
      "diff --name-only --cached": "",
      "diff --name-only": "",
    });

    const files = getChangedFiles("/project", "HEAD~1", exec);
    expect(files).toEqual(["src/core/a.ts"]);
  });
});

describe("mapChangedFilesToNodes", () => {
  const dag = makeMockDAG();

  it("maps source file to module ID", () => {
    const result = mapChangedFilesToNodes(
      ["src/core/ast/scanner.ts"],
      dag,
    );
    expect(result.moduleIds).toContain("module:src/core/ast/scanner.ts");
    expect(result.adrIds.size).toBe(0);
  });

  it("maps ADR file to ADR ID", () => {
    const result = mapChangedFilesToNodes(
      ["docs/adrs/ADR-001-typescript-compiler-api.md"],
      dag,
    );
    expect(result.adrIds).toContain("ADR-001");
    expect(result.moduleIds.size).toBe(0);
  });

  it("ignores files not in the DAG", () => {
    const result = mapChangedFilesToNodes(
      ["README.md", "package.json", "src/unknown.ts"],
      dag,
    );
    expect(result.moduleIds.size).toBe(0);
    expect(result.adrIds.size).toBe(0);
  });

  it("handles mixed source and ADR files", () => {
    const result = mapChangedFilesToNodes(
      [
        "src/cli/index.ts",
        "docs/adrs/ADR-004-html-viz.md",
        "README.md",
      ],
      dag,
    );
    expect(result.moduleIds).toContain("module:src/cli/index.ts");
    expect(result.adrIds).toContain("ADR-004");
  });
});

describe("expandAdrChangesToModules", () => {
  const dag = makeMockDAG();

  it("expands ADR to all bound modules", () => {
    const result = expandAdrChangesToModules(new Set(["ADR-001"]), dag);
    expect(result).toContain("module:src/core/ast/scanner.ts");
    expect(result).toContain("module:src/cli/index.ts");
    expect(result.size).toBe(2);
  });

  it("expands multiple ADRs", () => {
    const result = expandAdrChangesToModules(
      new Set(["ADR-001", "ADR-004"]),
      dag,
    );
    expect(result).toContain("module:src/core/ast/scanner.ts");
    expect(result).toContain("module:src/cli/index.ts");
    expect(result).toContain("module:src/core/viz/html-generator.ts");
    expect(result.size).toBe(3);
  });

  it("excludes external modules", () => {
    // Add an edge from ADR-001 to ext:chalk
    const dagWithExternal = makeMockDAG();
    dagWithExternal.edges["affects:ADR-001→ext:chalk"] = {
      id: "affects:ADR-001→ext:chalk",
      from: "ADR-001",
      to: "ext:chalk",
      kind: "affects",
      certainty: "inferred",
    };

    const result = expandAdrChangesToModules(
      new Set(["ADR-001"]),
      dagWithExternal,
    );
    expect(result).not.toContain("ext:chalk");
  });

  it("returns empty set for unknown ADR", () => {
    const result = expandAdrChangesToModules(
      new Set(["ADR-999"]),
      dag,
    );
    expect(result.size).toBe(0);
  });
});

describe("getAffectedModules (full pipeline)", () => {
  it("returns direct + ADR-expanded modules", () => {
    const dag = makeMockDAG();
    const exec = createMockExecutor({
      "rev-parse HEAD": "def456",
      "rev-parse --verify": "ok",
      "diff --name-only HEAD~1 HEAD":
        "src/core/ast/scanner.ts\ndocs/adrs/ADR-004-html-viz.md",
      "diff --name-only --cached": "",
      "diff --name-only": "",
    });

    const result = getAffectedModules("/project", dag, { exec });

    // Direct: scanner.ts → module:src/core/ast/scanner.ts
    // ADR-004 expanded → module:src/core/viz/html-generator.ts
    expect(result.affectedModuleIds).toContain(
      "module:src/core/ast/scanner.ts",
    );
    expect(result.affectedModuleIds).toContain(
      "module:src/core/viz/html-generator.ts",
    );
    expect(result.directModuleCount).toBe(1);
    expect(result.adrExpandedModuleCount).toBe(1);
  });

  it("uses snapshot commit hash as ref", () => {
    const dag = makeMockDAG();
    dag.snapshots = [
      {
        commitHash: "snap123",
        timestamp: "2025-06-01T00:00:00Z",
        bindings: [],
        driftCount: 0,
      },
    ];

    const exec = createMockExecutor({
      "rev-parse HEAD": "def456",
      "rev-parse --verify snap123": "snap123",
      "diff --name-only snap123 HEAD": "src/cli/index.ts",
      "diff --name-only --cached": "",
      "diff --name-only": "",
    });

    const result = getAffectedModules("/project", dag, { exec });
    expect(result.ref).toBe("snap123");
    expect(result.affectedModuleIds).toContain("module:src/cli/index.ts");
  });

  it("returns empty set when no DAG-relevant files changed", () => {
    const dag = makeMockDAG();
    const exec = createMockExecutor({
      "rev-parse HEAD": "def456",
      "diff --name-only HEAD~1 HEAD": "README.md\npackage.json",
      "diff --name-only --cached": "",
      "diff --name-only": "",
    });

    const result = getAffectedModules("/project", dag, { exec });
    expect(result.affectedModuleIds.size).toBe(0);
    expect(result.changedFiles).toEqual(["README.md", "package.json"]);
  });
});
