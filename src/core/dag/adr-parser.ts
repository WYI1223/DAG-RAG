/**
 * core/dag/adr-parser.ts
 *
 * Parses ADR markdown files into AdrNode objects.
 * Supports MADR format and Nygard format with a YAML-like frontmatter block.
 *
 * Frontmatter example:
 * ---
 * id: ADR-012
 * status: accepted
 * affects:
 *   - src/auth/
 *   - src/user/session.ts
 * supersedes: ADR-007
 * ---
 */

import * as fs from "fs";
import * as path from "path";
import { AdrNode } from "../../types/graph.js";

export interface AdrFrontmatter {
  id?: string;
  status?: string;
  affects?: string[];
  supersedes?: string;
  conflicts?: string[];
}

export interface ParsedAdr {
  node: AdrNode;
  frontmatter: AdrFrontmatter;
  body: string;
}

// ---- minimal YAML frontmatter parser (no deps) -------------

function parseFrontmatter(raw: string): AdrFrontmatter {
  const result: AdrFrontmatter = {};
  const lines = raw.split("\n");
  let i = 0;
  let currentArrayKey: string | null = null;

  while (i < lines.length) {
    const line = lines[i];

    // array item
    if (line.trimStart().startsWith("- ") && currentArrayKey) {
      const val = line.trimStart().slice(2).trim();
      (result as Record<string, unknown[]>)[currentArrayKey] ??= [];
      ((result as Record<string, unknown[]>)[currentArrayKey] as string[]).push(val);
      i++;
      continue;
    }

    // key: value
    const match = line.match(/^(\w+):\s*(.*)/);
    if (match) {
      const [, key, val] = match;
      currentArrayKey = null;
      if (val.trim() === "") {
        // next lines may be array items
        currentArrayKey = key;
      } else {
        (result as Record<string, string>)[key] = val.trim();
      }
    } else {
      currentArrayKey = null;
    }
    i++;
  }

  return result;
}

// ---- extract title from markdown body ----------------------

function extractTitle(body: string): string {
  const match = body.match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : "Untitled ADR";
}

// ---- parse a single ADR file -------------------------------

export function parseAdrFile(filePath: string): ParsedAdr | null {
  let content: string;
  try {
    content = fs.readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }

  let frontmatter: AdrFrontmatter = {};
  let body = content;

  // extract frontmatter between --- delimiters
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (fmMatch) {
    frontmatter = parseFrontmatter(fmMatch[1]);
    body = fmMatch[2];
  }

  const fileName = path.basename(filePath, ".md");
  const id = frontmatter.id ?? `ADR:${fileName}`;
  const title = extractTitle(body);

  const rawStatus = frontmatter.status ?? "proposed";
  const status: AdrNode["status"] = (
    ["proposed", "accepted", "deprecated", "superseded"].includes(rawStatus)
      ? rawStatus
      : "proposed"
  ) as AdrNode["status"];

  const node: AdrNode = {
    id,
    kind: "adr",
    label: title,
    title,
    status,
    filePath,
    createdAt: new Date().toISOString(),
  };

  return { node, frontmatter, body };
}

// ---- scan a directory for ADR files ------------------------

export function scanAdrDirectory(adrDir: string): ParsedAdr[] {
  if (!fs.existsSync(adrDir)) return [];

  const files = fs
    .readdirSync(adrDir)
    .filter((f) => f.endsWith(".md"))
    .map((f) => path.join(adrDir, f));

  return files.flatMap((f) => {
    const result = parseAdrFile(f);
    return result ? [result] : [];
  });
}
