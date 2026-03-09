import { describe, it, expect } from "vitest";
import * as path from "path";
import { parseAdrFile, scanAdrDirectory } from "../src/core/dag/adr-parser.js";

const FIXTURES = path.resolve(__dirname, "fixtures/sample-adrs");

describe("parseAdrFile", () => {
  it("parses frontmatter with id, status, affects, supersedes", () => {
    const result = parseAdrFile(path.join(FIXTURES, "ADR-010-use-redis.md"));
    expect(result).not.toBeNull();
    expect(result!.node.id).toBe("ADR-010");
    expect(result!.node.status).toBe("accepted");
    expect(result!.node.title).toBe("Use Redis for session caching");
    expect(result!.frontmatter.affects).toEqual(["src/"]);
    expect(result!.frontmatter.supersedes).toBe("ADR-005");
  });

  it("handles ADR without frontmatter", () => {
    const result = parseAdrFile(path.join(FIXTURES, "ADR-011-no-frontmatter.md"));
    expect(result).not.toBeNull();
    expect(result!.node.id).toBe("ADR:ADR-011-no-frontmatter");
    expect(result!.node.status).toBe("proposed"); // default
    expect(result!.node.title).toBe("Use PostgreSQL for persistent storage");
    expect(result!.frontmatter.affects).toBeUndefined();
  });

  it("returns null for nonexistent file", () => {
    const result = parseAdrFile(path.join(FIXTURES, "does-not-exist.md"));
    expect(result).toBeNull();
  });
});

describe("scanAdrDirectory", () => {
  it("finds all .md files in directory", () => {
    const results = scanAdrDirectory(FIXTURES);
    expect(results).toHaveLength(2);
    const ids = results.map((r) => r.node.id).sort();
    expect(ids).toEqual(["ADR-010", "ADR:ADR-011-no-frontmatter"]);
  });

  it("returns empty array for nonexistent directory", () => {
    const results = scanAdrDirectory(path.join(FIXTURES, "nope"));
    expect(results).toEqual([]);
  });
});
