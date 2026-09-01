import { expect, test } from "./helpers/qa-test";
import { provisionEmulatorUser } from "../scripts/lib/firebase-auth-emulator.mjs";

const signIn = async (
  page: import("@playwright/test").Page,
  email: string,
  password: string,
) => {
  await page.goto("/auth");
  await page.locator("#signin-email").fill(email);
  await page.locator("#signin-password").fill(password);
  await page.getByRole("button", { name: "Sign In", exact: true }).click();
};

test("a new user requests builder access and an admin approves it without email delivery", async ({ page }) => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const adminEmail = `request-admin-${suffix}@example.test`;
  const applicantEmail = `request-builder-${suffix}@example.test`;
  const adminPassword = "RequestAdmin9!";
  const applicantPassword = "RequestBuilder9!";

  await provisionEmulatorUser({
    email: adminEmail,
    password: adminPassword,
    displayName: "Request E2E Admin",
    role: "admin",
  });

  await page.goto("/auth");
  await page.getByRole("tab", { name: "Solicitar acceso", exact: true }).click();
  await page.getByLabel("Nombre completo", { exact: true }).fill("Request E2E Builder");
  await page.getByLabel("Email", { exact: true }).fill(applicantEmail);
  await page.getByLabel("Teléfono (opcional)", { exact: true }).fill("+57 301 000 0000");
  await page.getByRole("combobox", { name: "Perfil solicitado", exact: true }).selectOption("builder");
  await page.getByLabel("Contraseña", { exact: true }).fill(applicantPassword);
  await page.getByRole("button", { name: "Enviar solicitud como Builder", exact: true }).click();
  await expect(page.locator('[role="status"]').filter({ hasText: "Solicitud registrada" }).first()).toBeVisible();

  await signIn(page, adminEmail, adminPassword);
  const request = page.locator('[data-testid="access-request"]').filter({ hasText: applicantEmail });
  await expect(request).toContainText("Builder");
  await request.getByRole("button", { name: "Aprobar", exact: true }).click();
  await expect(request).toHaveCount(0);

  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await signIn(page, applicantEmail, applicantPassword);
  await expect(page).toHaveURL(/\/builders$/);
  await expect(page.getByRole("heading", { name: "Builder Dashboard" })).toBeVisible();
});
