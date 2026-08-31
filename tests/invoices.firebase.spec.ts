import { expect, test } from "./helpers/qa-test";
import {
  provisionAndSignInToAuthEmulator,
  provisionEmulatorUser,
  seedEmulatorProject,
} from "./helpers/firebase-auth-emulator";

test("builder submits a private invoice and manager approves it", async ({ page }) => {
  test.setTimeout(60_000);
  const reactKeyWarnings: string[] = [];
  page.on("pageerror", (error) => console.error(`[browser pageerror] ${error.stack ?? error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") {
      const text = message.text();
      console.error(`[browser console] ${text}`);
      if (text.includes("Encountered two children with the same key")) reactKeyWarnings.push(text);
    }
  });

  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const password = "InvoiceTest9!";
  const builderEmail = `invoice-builder-${suffix}@example.test`;
  const managerEmail = `invoice-manager-${suffix}@example.test`;
  const projectDocumentId = `invoice-project-${suffix}`;
  const builder = await provisionAndSignInToAuthEmulator({
    email: builderEmail,
    password,
    displayName: "Invoice E2E Builder",
    role: "builder",
  });
  const manager = await provisionEmulatorUser({
    email: managerEmail,
    password,
    displayName: "Invoice E2E Manager",
    role: "manager",
  });

  await seedEmulatorProject({
    projectId: projectDocumentId,
    builderId: builder.localId,
    createdBy: manager.uid,
    name: "Invoice E2E Project",
    description: "Invoice browser fixture",
    clientName: "Invoice Client",
    address: "Accounts Lane 7",
  });

  await page.goto("/auth");
  await page.locator("#signin-email").fill(builderEmail);
  await page.locator("#signin-password").fill(password);
  await page.getByRole("button", { name: "Sign In", exact: true }).click();
  await expect(page).toHaveURL(/\/builders$/, { timeout: 15_000 });
  await expect(page.getByRole("combobox")).toContainText("Invoice E2E Project");
  await expect(page.getByRole("heading", { name: "Reports and risk", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Daily report", exact: true })).toBeVisible();
  await page.getByLabel("What happened?").fill("Foundation inspection completed; no blockers.");
  await page.getByRole("button", { name: "Save report", exact: true }).click();
  await expect(page.getByText("Foundation inspection completed; no blockers.", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Submit an invoice", exact: true }).click();
  let dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("combobox", { name: "Invoice supplier", exact: true })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Scan image fields", exact: true })).toBeDisabled();
  await dialog.getByLabel("Invoice number").fill("INV-E2E-2048");
  await dialog.getByRole("textbox", { name: "Supplier", exact: true }).fill("Jedi Timber Supplies");
  await dialog.getByLabel("Invoice date").fill("2026-08-24");
  await dialog.getByLabel("Total amount (GBP)").fill("12.345");
  await dialog.getByLabel("Notes (optional)").fill("Timber delivery for the first floor");
  const onePixelPng = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64",
  );
  await dialog.getByLabel("Invoice file").setInputFiles({
    name: "invoice-evidence.png",
    mimeType: "image/png",
    buffer: onePixelPng,
  });
  await expect(dialog.getByRole("button", { name: "Scan image fields", exact: true })).toBeEnabled();
  await dialog.getByRole("button", { name: "Submit invoice", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("valid amount");
  await dialog.getByLabel("Total amount (GBP)").fill("1234.56");
  await dialog.getByRole("button", { name: "Submit invoice", exact: true }).click();
  const builderInvoice = dialog.locator('[data-testid="invoice-record"]');
  await expect(builderInvoice).toContainText("INV-E2E-2048", { timeout: 15_000 });
  await expect(builderInvoice).toContainText("£1,234.56");
  await expect(builderInvoice).toContainText("Pending review");
  await dialog.getByRole("button", { name: "Close", exact: true }).first().click();
  await page.getByRole("button", { name: "Sign Out", exact: true }).click();

  await page.locator("#signin-email").fill(managerEmail);
  await page.locator("#signin-password").fill(password);
  await page.getByRole("button", { name: "Sign In", exact: true }).click();
  await expect(page).toHaveURL(/\/managers$/, { timeout: 15_000 });
  await expect(page.getByRole("heading", { name: "Reports and risk", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Upload risk assessment", exact: true })).toBeVisible();
  await page.getByRole("combobox", { name: "Project for reports and risk", exact: true }).click();
  await page.getByRole("option", { name: /Invoice E2E Project/ }).click();
  await expect(page.getByText("Foundation inspection completed; no blockers.", { exact: true })).toBeVisible();
  await page.getByLabel("Document title").fill("Site risk assessment");
  const riskAssessmentPdf = Buffer.from("%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF");
  await page.getByLabel("Private PDF").setInputFiles({
    name: "site-risk-assessment.pdf",
    mimeType: "application/pdf",
    buffer: riskAssessmentPdf,
  });
  await page.getByRole("button", { name: "Upload assessment", exact: true }).click();
  await expect(page.getByText("Site risk assessment", { exact: true })).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "Sign out", exact: true }).click();

  await page.locator("#signin-email").fill(builderEmail);
  await page.locator("#signin-password").fill(password);
  await page.getByRole("button", { name: "Sign In", exact: true }).click();
  await expect(page).toHaveURL(/\/builders$/, { timeout: 15_000 });
  await expect(page.getByText("Site risk assessment", { exact: true })).toBeVisible({ timeout: 15_000 });
  const assessmentCard = page.getByText("Site risk assessment", { exact: true }).locator("xpath=ancestor::article");
  await assessmentCard.getByRole("button", { name: "Sign assessment", exact: true }).click();
  await expect(assessmentCard.getByText("Signed", { exact: true })).toBeVisible({ timeout: 15_000 });

  await page.getByRole("button", { name: "Sign Out", exact: true }).click();
  await page.locator("#signin-email").fill(managerEmail);
  await page.locator("#signin-password").fill(password);
  await page.getByRole("button", { name: "Sign In", exact: true }).click();
  await expect(page).toHaveURL(/\/managers$/, { timeout: 15_000 });
  await page.getByRole("button", { name: "Invoice review", exact: true }).click();
  dialog = page.getByRole("dialog");
  let managerInvoice = dialog.locator('[data-testid="invoice-review"]').filter({ hasText: "INV-E2E-2048" });
  await expect(managerInvoice).toContainText("Invoice E2E Builder");
  const download = page.waitForEvent("download");
  await managerInvoice.getByRole("button", { name: "Download invoice", exact: true }).click();
  await expect((await download).suggestedFilename()).toBe("invoice.png");
  await managerInvoice.getByLabel("Review notes for INV-E2E-2048").fill("Amount and project matched");
  await managerInvoice.getByRole("button", { name: "Approve invoice", exact: true }).click();
  await dialog.getByRole("tab", { name: "Approved", exact: true }).click();
  managerInvoice = dialog.locator('[data-testid="invoice-review"]').filter({ hasText: "INV-E2E-2048" });
  await expect(managerInvoice).toContainText("Approved");
  await expect(managerInvoice).toContainText("Amount and project matched");
  expect(reactKeyWarnings).toEqual([]);
});
