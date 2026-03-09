/**
 * core/semantic/code-summarizer.ts
 *
 * ADR-aware code summarization for drift checking.
 * Instead of blindly truncating files, this module:
 *   1. Extracts focus keywords from an ADR (title + backtick/quoted terms)
 *   2. Splits source code into logical blocks (imports, functions, classes, etc.)
 *   3. Includes keyword-matched blocks in full, collapses others to signatures
 */

import * as fs from "fs";
import { ParsedAdr } from "../dag/adr-parser.js";

// ---- keyword extraction ------------------------------------

const STOP_WORDS = new Set([
  // common English
  "use", "the", "for", "and", "with", "via", "from", "this", "that",
  "all", "are", "not", "can", "has", "have", "its", "into", "also",
  "any", "may", "but", "each", "our", "new", "add", "set", "get",
  "will", "when", "how", "which", "should", "must", "been", "being",
  "without", "using", "based", "allow", "ensure", "enable",
  // too generic for ADR context
  "implement", "implementation", "analysis", "pure", "specific",
  "existing", "current", "approach", "design", "strategy", "support",
  "direct", "primary", "consider", "require", "provide", "update",
  "create", "remove", "change", "make",
]);

/** Extract focus keywords from an ADR's title and body */
export function extractKeywords(adr: ParsedAdr): string[] {
  const keywords = new Set<string>();

  // 1. Title words (filter stop words and <=2 char terms)
  for (const w of adr.node.title.split(/[^a-zA-Z0-9._-]+/)) {
    if (w.length > 2 && !STOP_WORDS.has(w.toLowerCase())) {
      keywords.add(w.toLowerCase());
    }
  }

  // 2. Backtick-wrapped terms in body
  for (const [, term] of adr.body.matchAll(/`([^`]+)`/g)) {
    if (term.length > 2) keywords.add(term.toLowerCase());
  }

  // 3. Double-quoted single-word/identifier terms in body
  for (const [, term] of adr.body.matchAll(/"([^"]+)"/g)) {
    if (term.length > 2 && /^[a-zA-Z0-9._-]+$/.test(term)) {
      keywords.add(term.toLowerCase());
    }
  }

  return [...keywords];
}

// ---- code block splitting ----------------------------------

export interface CodeBlock {
  /** First meaningful code line (for collapsed display) */
  signature: string;
  /** Full block source */
  body: string;
  /** Number of lines */
  lineCount: number;
  /** Whether this is the imports section */
  isImports: boolean;
}

/** Detect if a line starts a new top-level block (must be at indent 0) */
function isBlockStart(line: string): boolean {
  const trimmed = line.trimStart();
  const indent = line.length - trimmed.length;
  if (indent > 0) return false;

  // Section comment markers: // ---- name ----
  if (/^\/\/\s*-{3,}/.test(trimmed)) return true;

  // Top-level declarations
  if (/^(export\s+)?(default\s+)?(async\s+)?(function)\s/.test(trimmed)) return true;
  if (/^(export\s+)?(abstract\s+)?(class)\s/.test(trimmed)) return true;
  if (/^(export\s+)?(const|let|var)\s/.test(trimmed)) return true;
  if (/^(export\s+)?(interface|type|enum)\s/.test(trimmed)) return true;

  return false;
}

/** Extract a meaningful signature from a block's lines */
function extractSignature(blockLines: string[]): string {
  let sectionName = "";
  let firstCode = "";

  for (const line of blockLines) {
    const t = line.trim();
    if (!sectionName) {
      const sm = t.match(/^\/\/\s*-+\s*(\w+)/);
      if (sm) { sectionName = sm[1]; continue; }
    }
    if (!firstCode && t !== "" && !t.startsWith("//") && !t.startsWith("/*") && !t.startsWith("*")) {
      firstCode = t;
      break;
    }
  }

  // Look for .command("name") pattern (Commander.js)
  const cmdMatch = blockLines.join("\n").match(/\.command\(["']([^"']+)["']\)/);

  if (sectionName && cmdMatch) return `[${sectionName}] .command("${cmdMatch[1]}")`;
  if (sectionName) return `[${sectionName}]`;
  if (cmdMatch) return `.command("${cmdMatch[1]}")`;
  return firstCode || blockLines[0]?.trim() || "";
}

/** Split source code into logical blocks */
export function splitIntoBlocks(code: string): CodeBlock[] {
  const lines = code.split("\n");
  const blocks: CodeBlock[] = [];

  // --- Phase 1: collect imports block ---
  // Scan for all import statements; include everything from line 0
  // to the last import (captures leading JSDoc/comments naturally).
  let lastImport = -1;
  let inMultiLine = false;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();

    if (inMultiLine) {
      if (trimmed.includes("}")) inMultiLine = false;
      lastImport = i;
      continue;
    }

    if (/^import[\s{]/.test(trimmed)) {
      if (trimmed.includes("{") && !trimmed.includes("}")) inMultiLine = true;
      lastImport = i;
      continue;
    }

    // Allow blanks, comments (// and /* */) before and between imports
    if (trimmed === "" || trimmed.startsWith("//") || trimmed.startsWith("/*")
        || trimmed.startsWith("*") || trimmed === "*/") {
      continue;
    }

    // Non-import, non-comment line: stop if we've already found imports
    if (lastImport >= 0) break;
    // Before any import: also stop (file doesn't start with imports)
    break;
  }

  const restStart = lastImport + 1;
  if (lastImport >= 0) {
    const importBody = lines.slice(0, restStart).join("\n");
    const count = lines.slice(0, restStart).filter(l => /^\s*import[\s{]/.test(l)).length;
    blocks.push({
      signature: `[imports: ${count} statements]`,
      body: importBody,
      lineCount: restStart,
      isImports: true,
    });
  }

  // --- Phase 2: split remaining into blocks ---
  let blockLines: string[] = [];

  function flush() {
    if (blockLines.length === 0) return;
    if (blockLines.every(l => l.trim() === "")) {
      blockLines = [];
      return;
    }
    blocks.push({
      signature: extractSignature(blockLines),
      body: blockLines.join("\n"),
      lineCount: blockLines.length,
      isImports: false,
    });
    blockLines = [];
  }

  for (let i = restStart; i < lines.length; i++) {
    if (isBlockStart(lines[i]) && blockLines.length > 0) {
      flush();
    }
    blockLines.push(lines[i]);
  }
  flush();

  return blocks;
}

// ---- summarization -----------------------------------------

const DEFAULT_BUDGET = 10000;

/**
 * Score blocks using IDF-weighted keyword matching.
 * Keywords appearing in fewer blocks get higher weight,
 * so "impact" (rare) outranks "graph" (common).
 */
function scoreBlocks(blocks: CodeBlock[], keywords: string[]): number[] {
  const nonImportBlocks = blocks.filter(b => !b.isImports);

  // Document frequency: how many blocks contain each keyword
  const df = new Map<string, number>();
  for (const kw of keywords) {
    let count = 0;
    for (const block of nonImportBlocks) {
      if (block.body.toLowerCase().includes(kw)) count++;
    }
    df.set(kw, Math.max(count, 1));
  }

  const total = nonImportBlocks.length || 1;
  return blocks.map(block => {
    if (block.isImports) return Infinity;
    const lower = block.body.toLowerCase();
    let score = 0;
    for (const kw of keywords) {
      if (lower.includes(kw)) {
        // IDF: keywords in fewer blocks get higher weight
        score += total / df.get(kw)!;
      }
    }
    return score;
  });
}

function collapseBlock(block: CodeBlock): string {
  return `// ${block.signature} — ${block.lineCount} lines`;
}

/**
 * Summarize a source file with ADR-aware relevance filtering.
 * - Small files (under budget): returned as-is
 * - Large files: imports always included, highest-scoring blocks expanded,
 *   others collapsed to one-line signatures. Reassembled in original order.
 */
export function summarizeForCheck(
  filePath: string,
  adr: ParsedAdr,
  budget: number = DEFAULT_BUDGET,
): string | null {
  let code: string;
  try {
    code = fs.readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }

  // Small files: return as-is
  if (code.length <= budget) return code;

  const keywords = extractKeywords(adr);
  const blocks = splitIntoBlocks(code);

  // Score each block by IDF-weighted keyword relevance
  const scores = scoreBlocks(blocks, keywords);
  const scored = blocks.map((block, idx) => ({
    block, idx, score: scores[idx],
  }));

  // Budget allocation: imports first, then highest-scoring blocks
  let chars = 0;
  const includeSet = new Set<number>();

  for (const { block, idx } of scored) {
    if (block.isImports) {
      includeSet.add(idx);
      chars += block.body.length;
    }
  }

  const ranked = scored
    .filter(s => !s.block.isImports && s.score > 0)
    .sort((a, b) => b.score - a.score);

  for (const { block, idx } of ranked) {
    if (chars + block.body.length <= budget) {
      includeSet.add(idx);
      chars += block.body.length;
    }
  }

  // Reassemble in original order
  const parts: string[] = [];
  for (const { block, idx } of scored) {
    parts.push(includeSet.has(idx) ? block.body : collapseBlock(block));
  }

  return parts.join("\n\n");
}
