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

test("admin reviews a requested profile and the user reaches the approved dashboard", async ({ page }) => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const password = "AccessReviewE2E9!";
  const adminEmail = `admin-review-${suffix}@example.test`;
  const applicantEmail = `applicant-review-${suffix}@example.test`;
  const applicantName = "Access Review E2E Builder";

  await provisionEmulatorUser({
    email: adminEmail,
    password,
    displayName: "Access Review E2E Admin",
    role: "admin",
  });
  await provisionEmulatorUser({
    email: applicantEmail,
    password,
    displayName: applicantName,
    fullName: applicantName,
    role: null,
  });

  await signIn(page, applicantEmail, password);
  await expect(page.getByText("La cuenta aún no tiene un perfil aprobado", { exact: true })).toBeVisible();
  await page.getByRole("combobox", { name: "Perfil solicitado", exact: true }).selectOption("manager");
  await page.getByRole("button", { name: "Solicitar acceso", exact: true }).click();
  await expect(page.locator('[role="status"]').filter({ hasText: "Solicitud registrada" }).first()).toBeVisible();

  await signIn(page, adminEmail, password);
  await expect(page).toHaveURL(/\/admins$/);
  await expect(page.getByRole("heading", { name: "Admin Dashboard" })).toBeVisible();
  const request = page.locator('[data-testid="access-request"]').filter({ hasText: applicantEmail });
  await expect(request).toContainText(applicantName);
  await expect(request).toContainText("Manager");
  await request.getByRole("button", { name: /Aprobar como Manager/ }).click();
  await expect(request).toHaveCount(0);

  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await signIn(page, applicantEmail, password);
  await expect(page).toHaveURL(/\/managers$/);
  await expect(page.getByRole("heading", { name: "Manager Dashboard" })).toBeVisible();
});
test("manager sees that only an administrator reviews access requests", async ({ page }) => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const password = "ManagerRoleE2E9!";
  const managerEmail = `manager-role-${suffix}@example.test`;
  await provisionEmulatorUser({
    email: managerEmail,
    password,
    displayName: "Manager Role E2E",
    role: "manager",
  });

  await signIn(page, managerEmail, password);
  await expect(page).toHaveURL(/\/managers$/);
  await page.goto("/invite");
  await expect(page.getByRole("heading", { name: "Solicitudes de acceso" })).toBeVisible();
  await expect(page.getByText("Las solicitudes las aprueba un administrador", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Aprobar", exact: true })).toHaveCount(0);
});
