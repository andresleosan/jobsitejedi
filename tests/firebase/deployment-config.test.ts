import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, test, vi } from "vitest";

const root = process.cwd();
const packageJson = JSON.parse(
  readFileSync(resolve(root, "package.json"), "utf8"),
) as { scripts: Record<string, string> };
const vercelJson = JSON.parse(
  readFileSync(resolve(root, "vercel.json"), "utf8"),
) as { rewrites: Array<{ source: string; destination: string }> };
const functionsSource = readFileSync(
  resolve(root, "functions/src/index.ts"),
  "utf8",
);
const firebaseClientSource = readFileSync(
  resolve(root, "src/lib/firebase/client.ts"),
  "utf8",
);
const firebaseConfigSource = readFileSync(
  resolve(root, "src/lib/firebase/config.ts"),
  "utf8",
);

const validFirebaseEnv = {
  VITE_FIREBASE_API_KEY: `AIza${"a".repeat(32)}`,
  VITE_FIREBASE_AUTH_DOMAIN: "jobsitejedi.firebaseapp.com",
  VITE_FIREBASE_PROJECT_ID: "jobsitejedi",
  VITE_FIREBASE_STORAGE_BUCKET: "jobsitejedi.firebasestorage.app",
  VITE_FIREBASE_MESSAGING_SENDER_ID: "548508412702",
  VITE_FIREBASE_APP_ID: "1:548508412702:web:abcdef1234567890",
  VITE_FIREBASE_USE_EMULATORS: "false",
};

const runValidator = (overrides: Record<string, string>, mode = "production") =>
  spawnSync(
    process.execPath,
    [resolve(root, "scripts/validate-firebase-client-env.mjs"), mode],
    {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, ...validFirebaseEnv, ...overrides },
    },
  );

describe("production deployment configuration", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  test("validates Firebase before every production build", () => {
    expect(packageJson.scripts.build).toBe(
      "node scripts/validate-firebase-client-env.mjs production && vite build",
    );
    expect(runValidator({}).status).toBe(0);
  });

  test("isolates staging from the production Firebase project", () => {
    expect(packageJson.scripts["build:staging"]).toBe(
      "node scripts/validate-firebase-client-env.mjs staging && vite build --mode staging",
    );
    expect(runValidator({}, "staging").status).toBe(1);
    expect(runValidator({
      VITE_FIREBASE_AUTH_DOMAIN: "jobsitejedi-staging.firebaseapp.com",
      VITE_FIREBASE_PROJECT_ID: "jobsitejedi-staging",
      VITE_FIREBASE_STORAGE_BUCKET: "jobsitejedi-staging.firebasestorage.app",
    }, "staging").status).toBe(0);
  });

  test("co-locates Functions with the European staging data plane", () => {
    expect(functionsSource).toContain(
      'setGlobalOptions({ region: "europe-west1" })',
    );
    expect(firebaseConfigSource).toContain(
      'functionsRegion: "europe-west1"',
    );
    expect(firebaseClientSource).toContain(
      "firebaseConfig.functionsRegion",
    );
  });

  test("rejects Vercel-style placeholder values without printing them", () => {
    const placeholders = Object.fromEntries(
      Object.keys(validFirebaseEnv)
        .filter((name) => name !== "VITE_FIREBASE_USE_EMULATORS")
        .map((name) => [name, name]),
    );
    const result = runValidator(placeholders);

    expect(result.status).toBe(1);
    for (const name of Object.keys(placeholders)) {
      expect(result.stderr).toContain(name);
    }
    expect(result.stderr).not.toContain(`AIza${"a".repeat(32)}`);
  });

  test("rejects emulator mode in a deployment build", () => {
    const result = runValidator({ VITE_FIREBASE_USE_EMULATORS: "true" });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "VITE_FIREBASE_USE_EMULATORS must not be true for a deployment build",
    );
  });

  test("rewrites client-side routes to the SPA entry point", () => {
    expect(vercelJson.rewrites).toContainEqual({
      source: "/(.*)",
      destination: "/index.html",
    });
  });

  test("refuses placeholder Firebase values at runtime outside emulators", async () => {
    vi.resetModules();
    for (const [name, value] of Object.entries(validFirebaseEnv)) {
      vi.stubEnv(name, value);
    }
    vi.stubEnv("VITE_FIREBASE_API_KEY", "VITE_FIREBASE_API_KEY");

    await expect(import("@/lib/firebase/config")).rejects.toThrow(
      "VITE_FIREBASE_API_KEY must be set by the deployment environment",
    );
  });
});
