import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";

const packageJson = JSON.parse(
  readFileSync(resolve(process.cwd(), "package.json"), "utf8"),
) as { scripts: Record<string, string> };

describe("Firebase test runners", () => {
  test("limits the Firebase runner to Firebase tests", () => {
    expect(packageJson.scripts["test:firebase"]).toContain("--dir tests/firebase");
    expect(packageJson.scripts["test:firebase"]).not.toContain("tests/storage.test.ts");
  });

  test("provides an emulator-backed Firebase runner", () => {
    expect(packageJson.scripts["test:firebase:emulator"]).toContain(
      "firebase emulators:exec",
    );
    expect(packageJson.scripts["test:firebase:emulator"]).toContain(
      "--only auth",
    );
  });

  test("provides a frontend typecheck runner", () => {
    expect(packageJson.scripts.typecheck).toBe(
      "tsc -p tsconfig.app.json --noEmit",
    );
  });
});
