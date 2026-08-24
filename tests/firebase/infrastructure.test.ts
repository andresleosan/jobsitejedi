import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";
import { firebaseConfig } from "@/lib/firebase/config";

describe("Firebase local infrastructure", () => {
  test("uses the local demo Firebase project", () => {
    expect(firebaseConfig.projectId).toBe("demo-jobsite-jedi");
    expect(firebaseConfig.emulators.auth).toBe(9099);
    expect(firebaseConfig.emulators.firestore).toBe(8080);
    expect(firebaseConfig.emulators.storage).toBe(9199);
  });

  test("provides a Functions scaffold entry point", () => {
    expect(existsSync(resolve(process.cwd(), "functions/src/index.ts"))).toBe(
      true,
    );

    const functionsPackage = JSON.parse(
      readFileSync(resolve(process.cwd(), "functions/package.json"), "utf8"),
    ) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };

    expect(functionsPackage.dependencies?.["firebase-functions"]).toBeDefined();
    expect(functionsPackage.devDependencies?.typescript).toMatch(/^~5\.8\.\d+$/);
  });
});
