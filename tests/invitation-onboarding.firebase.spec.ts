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

test("a roleless user requests builder access and an admin approves it without email delivery", async ({ page }) => {
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
  await provisionEmulatorUser({
    email: applicantEmail,
    password: applicantPassword,
    displayName: "Request E2E Builder",
    fullName: "Request E2E Builder",
    role: null,
  });

  await signIn(page, applicantEmail, applicantPassword);
  await page.getByRole("combobox", { name: "Perfil solicitado", exact: true }).selectOption("builder");
  await page.getByRole("button", { name: "Solicitar acceso", exact: true }).click();
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
