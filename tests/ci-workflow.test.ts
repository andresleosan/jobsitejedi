import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";

const root = resolve(import.meta.dirname, "..");
const workflow = readFileSync(resolve(root, ".github/workflows/ci.yml"), "utf8");
const playwrightConfig = readFileSync(
  resolve(root, "playwright.firebase.config.ts"),
  "utf8",
);

describe("CI workflow contract", () => {
  test("uses project runtimes and immutable official action revisions", () => {
    expect(workflow).toContain("node-version: 22");
    expect(workflow).toContain("java-version: 21");
    expect(workflow).toContain(
      "actions/checkout@d23441a48e516b6c34aea4fa41551a30e30af803",
    );
    expect(workflow).toContain(
      "actions/setup-node@820762786026740c76f36085b0efc47a31fe5020",
    );
    expect(workflow).toContain(
      "actions/setup-java@b6effb05e454b25005698d916606bdc6ffcbf961",
    );
  });

  test("runs static, emulator and E2E gates without deploying", () => {
    for (const command of [
      "npm run typecheck",
      "npm run lint",
      "npm run test:provider-guard",
      "npm run build:functions",
      "npm run test:firebase:emulator",
      "npm run test:e2e:firebase:emulator",
    ]) {
      expect(workflow).toContain(command);
    }

    expect(workflow).not.toMatch(/\b(?:firebase|vercel)\s+deploy\b/);
    expect(workflow).not.toContain("secrets.");
    expect(workflow).toContain("permissions:\n  contents: read");
    expect(workflow).toContain("persist-credentials: false");
  });

  test("keeps the Playwright runner cross-platform and bounded", () => {
    expect(playwrightConfig).toContain('command: "npm run dev -- --host localhost --port 5173"');
    expect(playwrightConfig).not.toContain("npm.cmd run dev");
    expect(playwrightConfig).toContain("workers: 2");
    expect(playwrightConfig).toContain("timeout: 15_000");
  });
});
