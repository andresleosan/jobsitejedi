import { expect, test } from "./helpers/qa-test";
import {
  provisionAndSignInToAuthEmulator,
  provisionEmulatorUser,
  seedEmulatorProject,
} from "./helpers/firebase-auth-emulator";

test("builder requests rubbish collection and manager resolves it", async ({ page }) => {
  test.setTimeout(60_000);
  page.on("pageerror", (error) => console.error(`[browser pageerror] ${error.stack ?? error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") console.error(`[browser console] ${message.text()}`);
  });

  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const password = "RubbishTest9!";
  const builderEmail = `rubbish-builder-${suffix}@example.test`;
  const managerEmail = `rubbish-manager-${suffix}@example.test`;
  const projectDocumentId = `rubbish-project-${suffix}`;
  const builder = await provisionAndSignInToAuthEmulator({
    email: builderEmail,
    password,
    displayName: "Rubbish E2E Builder",
    role: "builder",
  });
  const manager = await provisionEmulatorUser({
    email: managerEmail,
    password,
    displayName: "Rubbish E2E Manager",
    role: "manager",
  });

  await seedEmulatorProject({
    projectId: projectDocumentId,
    builderId: builder.localId,
    createdBy: manager.uid,
    name: "Rubbish E2E Project",
    description: "Rubbish collection browser fixture",
    clientName: "Rubbish Client",
    address: "Collection Lane 4",
  });

  await page.goto("/auth");
  await page.locator("#signin-email").fill(builderEmail);
  await page.locator("#signin-password").fill(password);
  await page.getByRole("button", { name: "Sign In", exact: true }).click();
  await expect(page).toHaveURL(/\/builders$/, { timeout: 15_000 });
  await expect(page.getByRole("combobox")).toContainText("Rubbish E2E Project - Rubbish Client");

  await page.getByRole("button", { name: "Request collection", exact: true }).click();
  let dialog = page.getByRole("dialog");
  const onePixelPng = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64",
  );
  await dialog.locator("#rubbish-photos").setInputFiles({
    name: "rubbish-evidence.png",
    mimeType: "image/png",
    buffer: onePixelPng,
  });
  await expect(dialog.getByAltText("Selected rubbish evidence 1")).toBeVisible();
  await dialog.getByLabel("Description (optional)").fill("Five timber offcuts beside the south gate");
  await dialog.getByRole("button", { name: "Submit collection request", exact: true }).click();
  const builderRequest = dialog.locator('[data-testid="rubbish-request"]');
  await expect(builderRequest).toContainText("Pending");
  await expect(builderRequest).toContainText("Five timber offcuts beside the south gate");
  await dialog.getByRole("button", { name: "Close", exact: true }).first().click();
  await page.getByRole("button", { name: "Sign Out", exact: true }).click();

  await page.locator("#signin-email").fill(managerEmail);
  await page.locator("#signin-password").fill(password);
  await page.getByRole("button", { name: "Sign In", exact: true }).click();
  await expect(page).toHaveURL(/\/managers$/, { timeout: 15_000 });
  await page.getByRole("button", { name: "Rubbish requests", exact: true }).click();
  dialog = page.getByRole("dialog");
  let managerRequest = dialog.locator('[data-testid="rubbish-request"]').filter({ hasText: "Rubbish E2E Project" });
  await expect(managerRequest).toContainText("Rubbish E2E Builder");
  await expect(managerRequest.getByRole("button", { name: "Open rubbish photo 1" })).toBeVisible();
  await managerRequest.getByRole("button", { name: "Mark resolved", exact: true }).click();
  await page.getByRole("button", { name: "Confirm resolved", exact: true }).click();
  await dialog.getByRole("tab", { name: "Resolved", exact: true }).click();
  managerRequest = dialog.locator('[data-testid="rubbish-request"]').filter({ hasText: "Rubbish E2E Project" });
  await expect(managerRequest).toContainText("Resolved");
});
