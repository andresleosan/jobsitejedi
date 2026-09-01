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

  test("keeps roleless sessions available to request an approved profile", () => {
    expect(dashboardSource).toContain('/auth?reason=missing-role');
    expect(authSource).toContain('Boolean(user && !user.role)');
    expect(authSource).toContain('registerForAccess');
    expect(authSource).toContain('submitAccessRequest');
    expect(authSource).toContain('Continue with Google');
    expect(authSource).toContain('perfil aprobado');
    expect(authSource).toContain('Cerrar sesi');
    expect(authSource).toContain('Solicitar acceso');
    expect(authSource).toContain('No se env');
  });
});
