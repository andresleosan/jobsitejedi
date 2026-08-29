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

const signUpBuilder = async (email: string, password: string) => {
  const created = await requestJson<AuthResponse>(`${authBaseUrl}/accounts:signUp?key=demo-api-key`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password, displayName: "E2E Builder", returnSecureToken: true }),
  });
  await requestJson(`${functionsBaseUrl}/ensureBuilderRole`, {
    method: "POST",
    headers: { authorization: `Bearer ${created.idToken}`, "content-type": "application/json" },
    body: JSON.stringify({ data: { role: "builder" } }),
  });
  return signIn(email, password);
};

const signIn = (email: string, password: string) => requestJson<AuthResponse>(
  `${authBaseUrl}/accounts:signInWithPassword?key=demo-api-key`,
  {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  },
);

const promoteToManager = async (userId: string) => {
  const [{ getApps, initializeApp }, { getAuth }] = await Promise.all([
    import("../functions/node_modules/firebase-admin/lib/app/index.js"),
    import("../functions/node_modules/firebase-admin/lib/auth/index.js"),
  ]);
  const adminApp = getApps().find((app) => app.name === "inventory-browser-tests")
    ?? initializeApp({ projectId }, "inventory-browser-tests");
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

test("builder requests a tool and manager completes its checkout lifecycle", async ({ page }) => {
  test.setTimeout(60_000);
  page.on("pageerror", (error) => console.error(`[browser pageerror] ${error.stack ?? error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") console.error(`[browser console] ${message.text()}`);
  });

  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const password = "InventoryTest9!";
  const builderEmail = `inventory-builder-${suffix}@example.test`;
  const managerEmail = `inventory-manager-${suffix}@example.test`;
  const projectDocumentId = `inventory-project-${suffix}`;
  const toolDocumentId = `inventory-tool-${suffix}`;
  const builder = await signUpBuilder(builderEmail, password);
  const managerBuilderSession = await signUpBuilder(managerEmail, password);
  await promoteToManager(managerBuilderSession.localId);
  const manager = await signIn(managerEmail, password);

  await createFirestoreDocument("projects", projectDocumentId, {
    ownerId: firestoreString(builder.localId),
    name: firestoreString("Inventory E2E Project"),
    description: firestoreString("Tool request browser fixture"),
    clientName: firestoreString("Inventory Client"),
    status: firestoreString("active"),
    createdAt: firestoreTimestamp(),
    updatedAt: firestoreTimestamp(),
  }, builder.idToken);

  await createFirestoreDocument("storageTools", toolDocumentId, {
    name: firestoreString("E2E Cordless Drill"),
    category: firestoreString("Power Tools"),
    condition: firestoreString("good"),
    status: firestoreString("available"),
    createdBy: firestoreString(manager.localId),
    createdAt: firestoreTimestamp(),
    updatedAt: firestoreTimestamp(),
  }, manager.idToken);

  await page.goto("/auth");
  await page.locator("#signin-email").fill(builderEmail);
  await page.locator("#signin-password").fill(password);
  await page.getByRole("button", { name: "Sign In", exact: true }).click();
  await expect(page).toHaveURL(/\/builders$/, { timeout: 15_000 });
  await expect(page.getByRole("combobox")).toContainText("Inventory E2E Project - Inventory Client");

  await page.getByRole("button", { name: "Request a tool" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: /E2E Cordless Drill/ }).click();
  await dialog.getByRole("button", { name: "Request Tool", exact: true }).click();
  await expect(dialog.getByText("E2E Cordless Drill")).toBeVisible();
  await expect(dialog.getByText("Pending", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await expect(dialog).toBeHidden();
  await page.getByRole("button", { name: "Sign Out", exact: true }).click();

  await page.locator("#signin-email").fill(managerEmail);
  await page.locator("#signin-password").fill(password);
  await page.getByRole("button", { name: "Sign In", exact: true }).click();
  await expect(page).toHaveURL(/\/managers$/, { timeout: 15_000 });
  await page.getByRole("link", { name: "Storage", exact: true }).click();
  await expect(page).toHaveURL(/\/storage$/);
  await page.getByRole("tab", { name: "Requests", exact: true }).click();

  const requestRow = page.getByRole("row").filter({ hasText: "E2E Cordless Drill" });
  await expect(requestRow).toContainText("Pending");
  await requestRow.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(requestRow).toContainText("Approved");
  await requestRow.getByRole("button", { name: "Check out", exact: true }).click();
  await expect(requestRow).toContainText("Picked Up");
  await requestRow.getByRole("button", { name: "Delivered", exact: true }).click();
  await expect(requestRow).toContainText("Delivered");

  await page.getByRole("tab", { name: "Checkouts", exact: true }).click();
  const checkoutRow = page.getByRole("row").filter({ hasText: "E2E Cordless Drill" });
  await expect(checkoutRow).toContainText("Checked Out");
  await checkoutRow.getByRole("button", { name: "Return", exact: true }).click();
  await expect(page.getByText("No checkouts found")).toBeVisible();

  await page.getByRole("tab", { name: "Requests", exact: true }).click();
  await page.getByLabel("Filter tool requests").click();
  await page.getByRole("option", { name: "Returned", exact: true }).click();
  await expect(page.getByRole("row").filter({ hasText: "E2E Cordless Drill" })).toContainText("Returned");
});
