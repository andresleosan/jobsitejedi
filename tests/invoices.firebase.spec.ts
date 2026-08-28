import { expect, test } from "@playwright/test";

const projectId = "demo-jobsite-jedi";
const authBaseUrl = "http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1";
const firestoreBaseUrl = `http://127.0.0.1:8080/v1/projects/${projectId}/databases/(default)/documents`;
const functionsBaseUrl = `http://127.0.0.1:5001/${projectId}/us-central1`;

interface AuthResponse {
  idToken: string;
  localId: string;
}

const requestJson = async <T>(url: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(url, init);
  const body = await response.text();
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${body}`);
  return body ? (JSON.parse(body) as T) : ({} as T);
};

const signIn = (email: string, password: string) => requestJson<AuthResponse>(
  `${authBaseUrl}/accounts:signInWithPassword?key=demo-api-key`,
  {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  },
);

const signUpBuilder = async (email: string, password: string, displayName: string) => {
  const created = await requestJson<AuthResponse>(`${authBaseUrl}/accounts:signUp?key=demo-api-key`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password, displayName, returnSecureToken: true }),
  });
  await requestJson(`${functionsBaseUrl}/ensureBuilderRole`, {
    method: "POST",
    headers: { authorization: `Bearer ${created.idToken}`, "content-type": "application/json" },
    body: JSON.stringify({ data: { role: "builder" } }),
  });
  return signIn(email, password);
};

const promoteToManager = async (userId: string) => {
  const [{ getApps, initializeApp }, { getAuth }] = await Promise.all([
    import("../functions/node_modules/firebase-admin/lib/app/index.js"),
    import("../functions/node_modules/firebase-admin/lib/auth/index.js"),
  ]);
  const adminApp = getApps().find((app) => app.name === "invoice-browser-tests")
    ?? initializeApp({ projectId }, "invoice-browser-tests");
  await getAuth(adminApp).setCustomUserClaims(userId, { role: "manager" });
};

const firestoreString = (value: string) => ({ stringValue: value });
const firestoreTimestamp = () => ({ timestampValue: new Date().toISOString() });

const createFirestoreDocument = async (
  collectionName: string,
  documentId: string,
  fields: Record<string, unknown>,
  idToken: string,
) => {
  await requestJson(`${firestoreBaseUrl}/${collectionName}?documentId=${encodeURIComponent(documentId)}`, {
    method: "POST",
    headers: { authorization: `Bearer ${idToken}`, "content-type": "application/json" },
    body: JSON.stringify({ fields }),
  });
};

test("builder submits a private invoice and manager approves it", async ({ page }) => {
  test.setTimeout(60_000);
  page.on("pageerror", (error) => console.error(`[browser pageerror] ${error.stack ?? error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") console.error(`[browser console] ${message.text()}`);
  });

  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const password = "InvoiceTest9!";
  const builderEmail = `invoice-builder-${suffix}@example.test`;
  const managerEmail = `invoice-manager-${suffix}@example.test`;
  const projectDocumentId = `invoice-project-${suffix}`;
  const builder = await signUpBuilder(builderEmail, password, "Invoice E2E Builder");
  const managerBuilderSession = await signUpBuilder(managerEmail, password, "Invoice E2E Manager");
  await promoteToManager(managerBuilderSession.localId);

  await createFirestoreDocument("projects", projectDocumentId, {
    ownerId: firestoreString(builder.localId),
    name: firestoreString("Invoice E2E Project"),
    description: firestoreString("Invoice browser fixture"),
    clientName: firestoreString("Invoice Client"),
    address: firestoreString("Accounts Lane 7"),
    status: firestoreString("active"),
    createdAt: firestoreTimestamp(),
    updatedAt: firestoreTimestamp(),
  }, builder.idToken);

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
  await expect((await download).suggestedFilename()).toBe("invoice-evidence.png");
  await managerInvoice.getByLabel("Review notes for INV-E2E-2048").fill("Amount and project matched");
  await managerInvoice.getByRole("button", { name: "Approve invoice", exact: true }).click();
  await dialog.getByRole("tab", { name: "Approved", exact: true }).click();
  managerInvoice = dialog.locator('[data-testid="invoice-review"]').filter({ hasText: "INV-E2E-2048" });
  await expect(managerInvoice).toContainText("Approved");
  await expect(managerInvoice).toContainText("Amount and project matched");
});
