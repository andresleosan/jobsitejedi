import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";

describe("Vite local exposure guard", () => {
  test("binds development and preview to IPv4 loopback by default", () => {
    const source = readFileSync(resolve(process.cwd(), "vite.config.ts"), "utf8");

    expect(source).toContain('host: "127.0.0.1"');
    expect(source).toContain('allowedHosts: ["localhost", "127.0.0.1"]');
    expect(source).not.toContain('host: "::"');
    expect(source).not.toContain('host: "0.0.0.0"');
    expect(source).not.toContain("lovable-tagger");
  });
});
