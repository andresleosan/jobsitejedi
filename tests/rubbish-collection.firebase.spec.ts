import { expect, test } from "@playwright/test";

const projectId = "demo-jobsite-jedi";
const authBaseUrl = "http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1";
const firestoreBaseUrl = `http://127.0.0.1:8080/v1/projects/${projectId}/databases/(default)/documents`;
const functionsBaseUrl = `http://127.0.0.1:5001/${projectId}/europe-west1`;

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
  const adminApp = getApps().find((app) => app.name === "rubbish-browser-tests")
    ?? initializeApp({ projectId }, "rubbish-browser-tests");
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
  const builder = await signUpBuilder(builderEmail, password, "Rubbish E2E Builder");
  const managerBuilderSession = await signUpBuilder(managerEmail, password, "Rubbish E2E Manager");
  await promoteToManager(managerBuilderSession.localId);

  await createFirestoreDocument("projects", projectDocumentId, {
    ownerId: firestoreString(builder.localId),
    name: firestoreString("Rubbish E2E Project"),
    description: firestoreString("Rubbish collection browser fixture"),
    clientName: firestoreString("Rubbish Client"),
    address: firestoreString("Collection Lane 4"),
    status: firestoreString("active"),
    createdAt: firestoreTimestamp(),
    updatedAt: firestoreTimestamp(),
  }, builder.idToken);

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
