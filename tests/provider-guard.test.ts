import { readdirSync, readFileSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";
import * as ts from "typescript";
import { describe, expect, test } from "vitest";

const sourceRoot = resolve(process.cwd(), "src");
const sourceExtensions = new Set([".js", ".jsx", ".ts", ".tsx"]);

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const filePath = join(directory, entry.name);

    if (entry.isDirectory()) {
      return sourceFiles(filePath);
    }

    return sourceExtensions.has(extname(entry.name)) ? [filePath] : [];
  });
}

const supabaseModules = new Set([
  "@/integrations/supabase/client",
  "@supabase/supabase-js",
]);

function isRuntimeImport(node: ts.ImportDeclaration): boolean {
  if (
    !ts.isStringLiteral(node.moduleSpecifier) ||
    !supabaseModules.has(node.moduleSpecifier.text)
  ) {
    return false;
  }

  const importClause = node.importClause;
  if (!importClause || importClause.isTypeOnly) {
    return false;
  }

  if (
    importClause.namedBindings &&
    ts.isNamedImports(importClause.namedBindings)
  ) {
    return importClause.namedBindings.elements.some(
      (element) => !element.isTypeOnly,
    );
  }

  return true;
}

function isInTypePosition(node: ts.Node): boolean {
  let parent = node.parent;
  while (parent && !ts.isSourceFile(parent)) {
    if (ts.isTypeNode(parent)) {
      return true;
    }
    if (ts.isStatement(parent)) {
      return false;
    }
    parent = parent.parent;
  }
  return false;
}

function runtimeSupabaseReferences(source: string, filePath: string): string[] {
  const sourceFile = ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    filePath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const lines = source.split(/\r?\n/);
  const matches: ts.Node[] = [];

  function visit(node: ts.Node): void {
    if (ts.isImportDeclaration(node) && isRuntimeImport(node)) {
      matches.push(node);
    } else if (!isInTypePosition(node)) {
      const isPropertyAccess =
        (ts.isPropertyAccessExpression(node) ||
          ts.isElementAccessExpression(node)) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === "supabase";
      const isDirectCall =
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === "supabase";

      if (isPropertyAccess || isDirectCall) {
        matches.push(node);
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);

  return matches.map((node) => {
    const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line;
    return `${filePath}:${line + 1}: ${lines[line]}`;
  });
}

function allSupabaseReferences(): string[] {
  return sourceFiles(sourceRoot).flatMap((filePath) =>
    runtimeSupabaseReferences(
      readFileSync(filePath, "utf8"),
      relative(process.cwd(), filePath),
    ),
  );
}

const references = allSupabaseReferences();

describe("provider migration guard", () => {
  test("reports remaining Supabase references under src", () => {
    expect(
      references,
      `Runtime Supabase references remain under src (${references.length}):\n${references.join("\n")}`,
    ).toEqual([]);
  });

  test("ignores comments and type declarations", () => {
    expect(references.some((reference) => reference.includes("Supabase Storage"))).toBe(
      false,
    );
    expect(references.some((reference) => reference.includes("__InternalSupabase"))).toBe(
      false,
    );
    const fixture = `
      // supabase.from("comments")
      function accepts(supabase: Client) {
        return "supabase.auth";
      }
      interface ClientWrapper { supabase: Client }
      type ClientAlias = { supabase: Client };
    `;

    expect(runtimeSupabaseReferences(fixture, "fixture.ts")).toEqual([]);
  });

  test("detects a runtime Supabase import and access", () => {
    const fixture = `
      import { supabase } from "@/integrations/supabase/client";
      supabase.from("jobs");
    `;

    expect(runtimeSupabaseReferences(fixture, "fixture.ts")).toHaveLength(2);
  });
});
