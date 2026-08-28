import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";

const dashboardSource = readFileSync(
  resolve(process.cwd(), "src/pages/Dashboard.tsx"),
  "utf8",
);
const authSource = readFileSync(
  resolve(process.cwd(), "src/pages/Auth.tsx"),
  "utf8",
);

describe("Firebase route auth guards", () => {
  test("uses the Firebase auth hook for the dashboard guard", () => {
    expect(dashboardSource).toContain('from "@/hooks/useAuth"');
    expect(dashboardSource).not.toContain("supabase");
    expect(dashboardSource).not.toContain("user_roles");
    expect(dashboardSource).not.toContain("onAuthStateChange");
  });

  test("routes missing-role sessions once and exposes Google as an accessible option", () => {
    expect(dashboardSource).toContain('/auth?reason=missing-role');
    expect(authSource).toContain('user?.role');
    expect(authSource).toContain('Continue with Google');
    expect(authSource).toContain('La cuenta no tiene un rol asignado');
    expect(authSource).toContain('Cerrar sesi\\u00f3n');
    expect(authSource).toContain('Reintentar');
    expect(authSource).toContain(
      'if (message === MISSING_ROLE_MESSAGE) setAccessError(message)',
    );
  });
});
