import { readdirSync, readFileSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";
import * as ts from "typescript";
import { afterEach, describe, expect, test, vi } from "vitest";
import { assertAuthEmulatorOnly } from "../scripts/lib/firebase-auth-emulator.mjs";

const runtimeRoots = [
  resolve(process.cwd(), "src"),
  resolve(process.cwd(), "functions/src"),
];
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
  return runtimeRoots.flatMap((root) =>
    sourceFiles(root).flatMap((filePath) =>
      runtimeSupabaseReferences(
        readFileSync(filePath, "utf8"),
        relative(process.cwd(), filePath),
      ),
    ),
  );
}

const references = allSupabaseReferences();

const directRoleAssignmentSources = [
  "functions/src/index.ts",
  "functions/lib/index.js",
  "src/lib/firebase/functions.ts",
  "src/lib/firebase/auth.ts",
];

const forbiddenDirectRoleAssignment = /\b(?:ensureBuilderRole|setUserRole|assignUserRole|registerBuilder)\b/g;
const forbiddenClientAuthProvisioning = /\bcreateUserWithEmailAndPassword\b/g;

function directRoleAssignmentReferences(): string[] {
  return directRoleAssignmentSources.flatMap((filePath) => {
    const source = readFileSync(resolve(process.cwd(), filePath), "utf8");
    const lines = source.split(/\r?\n/);
    return lines.flatMap((line, index) => {
      const matches = [...line.matchAll(forbiddenDirectRoleAssignment)];
      return matches.map((match) => `${filePath}:${index + 1}: ${match[0]}`);
    });
  });
}

function clientAuthProvisioningReferences(): string[] {
  return sourceFiles(resolve(process.cwd(), "src")).flatMap((filePath) => {
    const source = readFileSync(filePath, "utf8");
    const lines = source.split(/\r?\n/);
    return lines.flatMap((line, index) => {
      const matches = [...line.matchAll(forbiddenClientAuthProvisioning)];
      return matches.map((match) => (
        `${relative(process.cwd(), filePath)}:${index + 1}: ${match[0]}`
      ));
    });
  });
}

describe("provider migration guard", () => {
  test("reports remaining Supabase references under runtime sources", () => {
    expect(
      references,
      `Runtime Supabase references remain under runtime sources (${references.length}):\n${references.join("\n")}`,
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

describe("authorization surface guard", () => {
  test("keeps Firebase Auth identity creation out of browser runtime code", () => {
    const provisioningReferences = clientAuthProvisioningReferences();
    expect(
      provisioningReferences,
      `Client-side Firebase Auth provisioning was reintroduced:\n${provisioningReferences.join("\n")}`,
    ).toEqual([]);
  });

  test("keeps direct role-assignment callables out of runtime code", () => {
    const roleAssignmentReferences = directRoleAssignmentReferences();
    expect(
      roleAssignmentReferences,
      `Direct role-assignment surfaces were reintroduced:\n${roleAssignmentReferences.join("\n")}`,
    ).toEqual([]);
  });

  test("keeps invitation consumption as the runtime role-assignment path", () => {
    const backend = readFileSync(resolve(process.cwd(), "functions/src/index.ts"), "utf8");
    const client = readFileSync(resolve(process.cwd(), "src/lib/firebase/auth.ts"), "utf8");
    const functionsClient = readFileSync(resolve(process.cwd(), "src/lib/firebase/functions.ts"), "utf8");
    const authPage = readFileSync(resolve(process.cwd(), "src/pages/Auth.tsx"), "utf8");
    const roleOperation = readFileSync(
      resolve(process.cwd(), "scripts/assign-single-firebase-role.mjs"),
      "utf8",
    );
    const roleRevocation = readFileSync(
      resolve(process.cwd(), "scripts/revoke-single-firebase-role.mjs"),
      "utf8",
    );
    const loginVerifier = readFileSync(
      resolve(process.cwd(), "scripts/verify-single-firebase-login.mjs"),
      "utf8",
    );
    const roleSafety = readFileSync(
      resolve(process.cwd(), "scripts/lib/firebase-role-safety.mjs"),
      "utf8",
    );

    expect(backend).toContain("export const consumeInvitation");
    expect(backend).toContain("export const activateInvitation");
    expect(backend).toContain("normalizeInvitationActivationPassword");
    expect(backend).toContain("emailVerified: true");
    expect(client).toContain("export const registerWithInvitation");
    expect(functionsClient).toContain("activateInvitationCallable");
    expect(backend).not.toContain("request.data.invitationId");
    expect(client).not.toContain("invitationId");
    expect(backend).toContain('.where("codeHash", "==", codeHash)');
    expect(backend).toContain("!user.emailVerified");
    expect(backend).toContain('collection("invitationTargets")');
    expect(backend).toContain("const INVITATION_SCHEMA_VERSION = 4");
    expect(backend).toContain("getOrCreateInvitationTarget");
    expect(backend).toContain("targetEnrollmentHash");
    expect(backend).toContain("requestKeyHash");
    expect(backend).toContain("decryptInvitationCode");
    expect(backend).toContain("delete preservedClaims.invitationEnrollmentId");
    expect(backend).toContain("request.auth.token.authorizationGrantId");
    expect(backend).toContain('collection("authorizationGrants")');
    expect(backend).toContain("transaction.create(authorizationGrantReference");
    expect(backend).toContain('claimAssignmentState: "not_started"');
    expect(client).toContain("activateInvitation");
    expect(client).not.toContain("requestInvitationActivation");
    expect(client).not.toContain("sendPasswordResetEmail");
    expect(client).not.toContain("completeInvitationRegistration");
    expect(client).toContain("token.claims.authorizationGrantId");
    expect(authPage).toContain("validationSequenceRef");
    expect(authPage).toContain("validatedInvitationCode !== normalizedInvitationCode");
    expect(authPage).toContain("buildtrack.pendingInvitation");
    expect(roleSafety).toContain("user.emailVerified !== true");
    expect(roleSafety).toContain("user.customClaims?.invitationEnrollmentId !== undefined");
    expect(roleOperation).toContain("assertRoleAssignmentTarget");
    expect(roleOperation).toContain("targetUid");
    expect(roleOperation).toContain("authorizationGrantId: nextGrantId");
    expect(roleOperation).toContain('collection("authorizationGrants")');
    expect(roleOperation).toContain("Role assignment state is indeterminate");
    expect(roleRevocation).toContain("assertRoleRevocationTarget");
    expect(roleRevocation).toContain("active: false");
    expect(roleRevocation).toContain("delete nextClaims.role");
    expect(roleRevocation).toContain("Role revocation state is indeterminate");
    expect(roleRevocation).not.toContain("setCustomUserClaims(user.uid, previousClaims)");
    expect(loginVerifier).toContain("authorizationGrantMatches");
    expect(loginVerifier).toContain("protectedRead");
    expect(loginVerifier).toContain("targetUid");
    expect(loginVerifier).toContain("expectedUsers");
  });
});

describe("QA Auth Emulator fixture guard", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  test("rejects a non-loopback Auth host", () => {
    vi.stubEnv("FIREBASE_AUTH_EMULATOR_HOST", "auth.example.test:9099");
    vi.stubEnv("GCLOUD_PROJECT", "demo-jobsite-jedi");

    expect(() => assertAuthEmulatorOnly()).toThrow(
      "Refusing to provision users outside a loopback Firebase Auth emulator",
    );
  });

  test("rejects a non-emulator project even on loopback", () => {
    vi.stubEnv("FIREBASE_AUTH_EMULATOR_HOST", "127.0.0.1:9099");
    vi.stubEnv("GCLOUD_PROJECT", "jobsitejedi");

    expect(() => assertAuthEmulatorOnly()).toThrow(
      "Expected emulator project demo-jobsite-jedi",
    );
  });

  test("accepts only the local demo project and reads the password from the environment", () => {
    vi.stubEnv("FIREBASE_AUTH_EMULATOR_HOST", "127.0.0.1:9099");
    vi.stubEnv("GCLOUD_PROJECT", "demo-jobsite-jedi");
    const seedScript = readFileSync(resolve(process.cwd(), "scripts/seed-qa-users.mjs"), "utf8");

    expect(assertAuthEmulatorOnly()).toEqual({
      emulatorHost: "127.0.0.1:9099",
      projectId: "demo-jobsite-jedi",
    });
    expect(seedScript).toContain("process.env.QA_TEST_PASSWORD");
    expect(seedScript).not.toMatch(/const password\s*=\s*["']/);
    expect(seedScript).toMatch(/email:\s*["']admin@admin\.com["'][\s\S]*?role:\s*["']admin["']/);
    expect(seedScript).toMatch(/email:\s*["']manager@manager\.com["'][\s\S]*?role:\s*["']manager["']/);
    expect(seedScript).toMatch(/email:\s*["']builder@builder\.com["'][\s\S]*?role:\s*["']builder["']/);
  });
});
