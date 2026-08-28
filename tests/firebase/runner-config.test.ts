import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";

const packageJson = JSON.parse(
  readFileSync(resolve(process.cwd(), "package.json"), "utf8"),
) as { engines: { node: string }; scripts: Record<string, string> };
const functionsPackageJson = JSON.parse(
  readFileSync(resolve(process.cwd(), "functions/package.json"), "utf8"),
) as { engines: { node: string } };
const firebaseJson = JSON.parse(
  readFileSync(resolve(process.cwd(), "firebase.json"), "utf8"),
) as { functions: { runtime: string } };
const runnerSource = readFileSync(
  resolve(process.cwd(), "scripts/firebase-emulator-runner.mjs"),
  "utf8",
);

describe("Firebase test runners", () => {
  test("limits the Firebase runner to Firebase tests", () => {
    expect(packageJson.scripts["test:firebase"]).toContain("--dir tests/firebase");
    expect(packageJson.scripts["test:firebase"]).not.toContain("tests/storage.test.ts");
  });

  test("provides an emulator-backed Firebase runner", () => {
    expect(packageJson.scripts["test:firebase:emulator"]).toBe(
      "node scripts/firebase-emulator-runner.mjs unit",
    );
    expect(packageJson.scripts["test:e2e:auth:emulator"]).toBe(
      "node scripts/firebase-emulator-runner.mjs auth-e2e",
    );
    expect(runnerSource).toContain('"emulators:exec"');
    expect(runnerSource).toContain(
      'const FIREBASE_SERVICES = "auth,firestore,functions,storage"',
    );
  });

  test("pins the supported Firebase runtime and fails fast on toolchain drift", () => {
    expect(packageJson.engines.node).toBe("22");
    expect(functionsPackageJson.engines.node).toBe("22");
    expect(firebaseJson.functions.runtime).toBe("nodejs22");
    expect(runnerSource).toContain("const REQUIRED_NODE_MAJOR = 22");
    expect(runnerSource).toContain("const REQUIRED_JAVA_MAJOR = 21");
    expect(runnerSource).toContain(
      'const FUNCTIONS_DISCOVERY_TIMEOUT = "30000"',
    );
  });

  test("provides a frontend typecheck runner", () => {
    expect(packageJson.scripts.typecheck).toBe(
      "tsc -p tsconfig.app.json --noEmit",
    );
  });
});
