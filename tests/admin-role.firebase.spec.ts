import { expect, test } from "./helpers/qa-test";
import { provisionEmulatorUser } from "./helpers/firebase-auth-emulator";

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

test("admin reaches its dashboard, invites managers, and cannot self-service another admin", async ({ page }) => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const password = "AdminRoleE2E9!";
  const adminEmail = `admin-role-${suffix}@example.test`;
  await provisionEmulatorUser({
    email: adminEmail,
    password,
    displayName: "Admin Role E2E",
    role: "admin",
  });

  await signIn(page, adminEmail, password);
  await expect(page).toHaveURL(/\/admins$/);
  await expect(page.getByRole("heading", { name: "Admin Dashboard" })).toBeVisible();
  await page.getByRole("link", { name: "Invite member" }).click();
  await page.getByRole("combobox").click();
  await expect(page.getByRole("option", { name: "Admin" })).toHaveCount(0);
  await expect(page.getByRole("option", { name: "Manager" })).toBeVisible();
  await page.getByRole("option", { name: "Manager" }).click();
  await page.getByLabel("Invitee email").fill(`invited-manager-${suffix}@example.test`);
  await page.getByRole("button", { name: "Generate QR Code" }).click();
  await expect(page.getByAltText("Invitation QR Code")).toBeVisible();
  await expect(page.getByText("Manager Invitation", { exact: true })).toBeVisible();
});

test("manager cannot issue privileged invitations", async ({ page }) => {
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
  await page.getByRole("link", { name: "Invite member" }).click();
  await page.getByRole("combobox").click();
  await expect(page.getByRole("option", { name: "Builder" })).toBeVisible();
  await expect(page.getByRole("option", { name: "Admin" })).toHaveCount(0);
  await expect(page.getByRole("option", { name: "Manager" })).toHaveCount(0);
  await page.getByRole("option", { name: "Builder" }).click();
  await page.getByLabel("Invitee email").fill(`invited-builder-${suffix}@example.test`);
  await page.getByRole("button", { name: "Generate QR Code" }).click();
  await expect(page.getByAltText("Invitation QR Code")).toBeVisible();
  await expect(page.getByText("Builder Invitation", { exact: true })).toBeVisible();
});
