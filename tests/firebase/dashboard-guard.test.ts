import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";

const dashboardSource = readFileSync(
  resolve(process.cwd(), "src/pages/Dashboard.tsx"),
  "utf8",
);

describe("Firebase route auth guards", () => {
  test("uses the Firebase auth hook for the dashboard guard", () => {
    expect(dashboardSource).toContain('from "@/hooks/useAuth"');
    expect(dashboardSource).not.toContain("supabase");
    expect(dashboardSource).not.toContain("user_roles");
    expect(dashboardSource).not.toContain("onAuthStateChange");
  });
});
