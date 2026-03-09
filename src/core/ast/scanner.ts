/**
 * ast/scanner.ts
 *
 * Uses the TypeScript Compiler API to extract structural facts from source files.
 * This is the CERTAIN layer — everything here is deterministic, no LLM involved.
 *
 * Produces: ModuleNode[] + depends_on edges (GraphEdge[])
 */

import ts from "typescript";
import * as path from "path";
import * as fs from "fs";
import { ModuleNode, GraphEdge } from "../../types/graph.js";

export interface ScanResult {
  modules: ModuleNode[];
  edges: GraphEdge[];    // depends_on edges only at this stage
}

export interface ScanOptions {
  projectRoot: string;
  tsConfigPath?: string;
  include?: string[];    // glob patterns, default ["**/*.ts", "**/*.tsx"]
  exclude?: string[];
}

// ---- helpers -----------------------------------------------

function makeModuleId(filePath: string, root: string): string {
  const rel = path.relative(root, filePath).replace(/\\/g, "/");
  return `module:${rel}`;
}

function makeEdgeId(from: string, to: string, kind: string): string {
  return `${kind}:${from}→${to}`;
}

// ---- extract exports from a source file --------------------

function extractExports(sourceFile: ts.SourceFile): string[] {
  const exports: string[] = [];

  function visit(node: ts.Node) {
    // export function foo() / export const foo = ...
    if (
      (ts.isFunctionDeclaration(node) ||
        ts.isVariableStatement(node) ||
        ts.isClassDeclaration(node) ||
        ts.isInterfaceDeclaration(node) ||
        ts.isTypeAliasDeclaration(node) ||
        ts.isEnumDeclaration(node)) &&
      node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
    ) {
      if ("name" in node && node.name) {
        exports.push((node.name as ts.Identifier).text);
      }
      if (ts.isVariableStatement(node)) {
        node.declarationList.declarations.forEach((d) => {
          if (ts.isIdentifier(d.name)) exports.push(d.name.text);
        });
      }
    }
    // export { foo, bar }
    if (ts.isExportDeclaration(node) && node.exportClause) {
      if (ts.isNamedExports(node.exportClause)) {
        node.exportClause.elements.forEach((el) => {
          exports.push(el.name.text);
        });
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return [...new Set(exports)];
}

// ---- extract imports from a source file --------------------

function extractImports(sourceFile: ts.SourceFile): string[] {
  const imports: string[] = [];

  function visit(node: ts.Node) {
    if (ts.isImportDeclaration(node)) {
      const specifier = (node.moduleSpecifier as ts.StringLiteral).text;
      imports.push(specifier);
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return [...new Set(imports)];
}

// ---- resolve import path to absolute -----------------------

function resolveImport(
  importPath: string,
  fromFile: string,
  root: string
): string | null {
  // only resolve relative imports — skip node_modules
  if (!importPath.startsWith(".")) return null;

  // strip .js/.jsx extension — TS ESM projects use .js imports for .ts files
  const stripped = importPath.replace(/\.(js|jsx)$/, "");

  const dir = path.dirname(fromFile);
  const candidates = [
    path.resolve(dir, stripped),
    path.resolve(dir, stripped + ".ts"),
    path.resolve(dir, stripped + ".tsx"),
    path.resolve(dir, stripped, "index.ts"),
  ];

  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

// ---- main scan function ------------------------------------

export async function scanProject(options: ScanOptions): Promise<ScanResult> {
  const { projectRoot } = options;

  // find all TS files
  const { glob } = await import("glob");
  const patterns = options.include ?? ["**/*.ts", "**/*.tsx"];
  const exclude = [
    "node_modules/**",
    "dist/**",
    "**/*.d.ts",
    "**/fixtures/**",
    ...(options.exclude ?? []),
  ];

  const files: string[] = [];
  for (const pattern of patterns) {
    const found = await glob(pattern, {
      cwd: projectRoot,
      ignore: exclude,
      absolute: true,
    });
    files.push(...found);
  }

  // build a TS program for type-aware analysis
  const tsConfigPath =
    options.tsConfigPath ?? path.join(projectRoot, "tsconfig.json");

  let compilerOptions: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    strict: true,
  };

  if (fs.existsSync(tsConfigPath)) {
    const configFile = ts.readConfigFile(tsConfigPath, ts.sys.readFile);
    const parsed = ts.parseJsonConfigFileContent(
      configFile.config,
      ts.sys,
      path.dirname(tsConfigPath)
    );
    compilerOptions = parsed.options;
  }

  const program = ts.createProgram(files, compilerOptions);
  const modules: ModuleNode[] = [];
  const edgeMap = new Map<string, GraphEdge>();

  for (const filePath of files) {
    const sourceFile = program.getSourceFile(filePath);
    if (!sourceFile) continue;

    const id = makeModuleId(filePath, projectRoot);
    const exports = extractExports(sourceFile);
    const rawImports = extractImports(sourceFile);
    const imports = rawImports.filter((i) => !i.startsWith("."));

    const moduleNode: ModuleNode = {
      id,
      kind: "module",
      label: path.relative(projectRoot, filePath).replace(/\\/g, "/"),
      filePath,
      language: "typescript",
      exports,
      imports: rawImports,
      createdAt: new Date().toISOString(),
    };
    modules.push(moduleNode);

    // build depends_on edges for relative imports
    for (const imp of rawImports) {
      const resolved = resolveImport(imp, filePath, projectRoot);
      if (!resolved) continue;

      const toId = makeModuleId(resolved, projectRoot);
      const edgeId = makeEdgeId(id, toId, "depends_on");

      if (!edgeMap.has(edgeId)) {
        edgeMap.set(edgeId, {
          id: edgeId,
          from: id,
          to: toId,
          kind: "depends_on",
          certainty: "certain",   // AST-derived, deterministic
        });
      }
    }
  }

  return { modules, edges: [...edgeMap.values()] };
}
