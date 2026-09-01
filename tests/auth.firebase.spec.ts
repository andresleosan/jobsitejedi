import { expect, test } from "./helpers/qa-test";
import { provisionEmulatorUser } from "../scripts/lib/firebase-auth-emulator.mjs";

test("a roleless account can request a profile without redirect loops", async ({ page }) => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const email = `e2e-unassigned-${suffix}@example.test`;
  const password = "UnassignedTest9!";
  const transitions: string[] = [];

  await provisionEmulatorUser({
    email,
    password,
    displayName: "Unassigned E2E User",
    fullName: "Unassigned E2E User",
    role: null,
  });
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) transitions.push(frame.url());
  });

  await page.goto("/auth");
  await expect(page.getByRole("button", { name: "Continue with Google", exact: true })).toBeVisible();
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign In", exact: true }).click();

  await expect(page.getByText("La cuenta aún no tiene un perfil aprobado", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Solicitar acceso", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Cerrar sesión", exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/auth$/);
  await expect(page.getByRole("combobox", { name: "Perfil solicitado", exact: true })).toHaveValue("builder");

  await page.getByRole("button", { name: "Solicitar acceso", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Solicitud registrada");
  expect(transitions.some((url) => /\/dashboard(?:\?|$)/.test(url))).toBe(false);
  expect(transitions.filter((url) => /\/auth(?:\?|$)/.test(url)).length).toBeLessThanOrEqual(2);
});
