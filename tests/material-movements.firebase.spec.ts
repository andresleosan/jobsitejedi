import { expect, test } from "@playwright/test";

const firebaseProjectId = "demo-jobsite-jedi";
const authBaseUrl = "http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1";
const firestoreBaseUrl = `http://127.0.0.1:8080/v1/projects/${firebaseProjectId}/databases/(default)/documents`;
const functionsBaseUrl = `http://127.0.0.1:5001/${firebaseProjectId}/us-central1`;

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

const createManager = async (email: string, password: string, displayName: string) => {
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

  const [{ getApps, initializeApp }, { getAuth }] = await Promise.all([
    import("../functions/node_modules/firebase-admin/lib/app/index.js"),
    import("../functions/node_modules/firebase-admin/lib/auth/index.js"),
  ]);
  const adminApp = getApps().find((app) => app.name === "movement-browser-tests")
    ?? initializeApp({ projectId: firebaseProjectId }, "movement-browser-tests");
  await getAuth(adminApp).setCustomUserClaims(created.localId, { role: "manager" });
  return signIn(email, password);
};

const firestoreString = (value: string) => ({ stringValue: value });
const firestoreInteger = (value: number) => ({ integerValue: String(value) });
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

test("manager records transfers and direct usage with atomic stock deductions", async ({ page }) => {
  test.setTimeout(60_000);
  page.on("pageerror", (error) => console.error(`[browser pageerror] ${error.stack ?? error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") console.error(`[browser console] ${message.text()}`);
  });

  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const password = "MovementTest9!";
  const email = `movement-manager-${suffix}@example.test`;
  const projectDocumentId = `movement-project-${suffix}`;
  const materialDocumentId = `movement-material-${suffix}`;
  const manager = await createManager(email, password, "Movement E2E Manager");

  await createFirestoreDocument("projects", projectDocumentId, {
    ownerId: firestoreString(manager.localId),
    name: firestoreString("Movement E2E Project"),
    description: firestoreString("Material movement browser fixture"),
    clientName: firestoreString("Movement Client"),
    status: firestoreString("active"),
    createdAt: firestoreTimestamp(),
    updatedAt: firestoreTimestamp(),
  }, manager.idToken);

  await createFirestoreDocument("storageMaterials", materialDocumentId, {
    name: firestoreString("E2E Movement Cement"),
    category: firestoreString("Building Materials"),
    quantity: firestoreInteger(20),
    unit: firestoreString("bags"),
    minStockLevel: firestoreInteger(2),
    createdBy: firestoreString(manager.localId),
    createdAt: firestoreTimestamp(),
    updatedAt: firestoreTimestamp(),
  }, manager.idToken);

  await page.goto("/auth");
  await page.locator("#signin-email").fill(email);
  await page.locator("#signin-password").fill(password);
  await page.getByRole("button", { name: "Sign In", exact: true }).click();
  await expect(page).toHaveURL(/\/managers$/, { timeout: 15_000 });
  await page.getByRole("link", { name: "Storage", exact: true }).click();
  await expect(page).toHaveURL(/\/storage$/);
  await page.getByRole("tab", { name: "Movements", exact: true }).click();

  await page.getByLabel("Material", { exact: true }).click();
  await page.getByRole("option", { name: /E2E Movement Cement/ }).click();
  await page.getByLabel("Project", { exact: true }).click();
  await page.getByRole("option", { name: "Movement E2E Project", exact: true }).click();
  await page.getByLabel("Quantity", { exact: true }).fill("5");
  await page.getByLabel("Notes", { exact: true }).fill("First site issue");
  await page.getByRole("button", { name: "Record transfer", exact: true }).click();

  let movement = page.getByTestId("material-movement").filter({ hasText: "First site issue" });
  await expect(movement).toContainText("Transfer");
  await expect(movement).toContainText("E2E Movement Cement → Movement E2E Project");
  await expect(movement).toContainText("Movement E2E Manager");
  await expect(movement).toContainText("−5 bags");

  await page.getByRole("tab", { name: "Direct usage", exact: true }).click();
  await page.getByLabel("Material", { exact: true }).click();
  await page.getByRole("option", { name: /E2E Movement Cement · 15 bags available/ }).click();
  await page.getByLabel("Project", { exact: true }).click();
  await page.getByRole("option", { name: "Movement E2E Project", exact: true }).click();
  await page.getByLabel("Quantity", { exact: true }).fill("3");
  await page.getByLabel("Notes", { exact: true }).fill("Direct pour usage");
  await page.getByRole("button", { name: "Record usage", exact: true }).click();

  movement = page.getByTestId("material-movement").filter({ hasText: "Direct pour usage" });
  await expect(movement).toContainText("Direct usage");
  await expect(movement).toContainText("−3 bags");
  await expect(page.getByText("2 records", { exact: true })).toBeVisible();

  await page.getByRole("tab", { name: "Materials", exact: true }).click();
  await expect(page.getByRole("row").filter({ hasText: "E2E Movement Cement" })).toContainText("12 bags");
});
