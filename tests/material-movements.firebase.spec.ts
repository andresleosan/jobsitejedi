import { expect, test } from "./helpers/qa-test";
import {
  provisionAndSignInToAuthEmulator,
  provisionEmulatorUser,
  seedEmulatorProject,
} from "./helpers/firebase-auth-emulator";

const firebaseProjectId = "demo-jobsite-jedi";
const firestoreBaseUrl = `http://127.0.0.1:8080/v1/projects/${firebaseProjectId}/databases/(default)/documents`;

const requestJson = async <T>(url: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(url, init);
  const body = await response.text();
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${body}`);
  return body ? (JSON.parse(body) as T) : ({} as T);
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
  const manager = await provisionAndSignInToAuthEmulator({
    email,
    password,
    displayName: "Movement E2E Manager",
    role: "manager",
  });
  const builder = await provisionEmulatorUser({
    email: `movement-builder-${suffix}@example.test`,
    password,
    displayName: "Movement E2E Builder",
    role: "builder",
  });

  await seedEmulatorProject({
    projectId: projectDocumentId,
    builderId: builder.uid,
    createdBy: manager.localId,
    name: "Movement E2E Project",
    description: "Material movement browser fixture",
    clientName: "Movement Client",
  });

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
  await expect(page.getByText("Transfer recorded", { exact: true })).toBeVisible();

  let movement = page.getByTestId("material-movement").filter({ hasText: "First site issue" });
  await expect(movement).toContainText("Transfer", { timeout: 15_000 });
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
  await expect(page.getByText("Usage recorded", { exact: true })).toBeVisible();

  movement = page.getByTestId("material-movement").filter({ hasText: "Direct pour usage" });
  await expect(movement).toContainText("Direct usage", { timeout: 15_000 });
  await expect(movement).toContainText("−3 bags");
  await expect(page.getByText("2 records", { exact: true })).toBeVisible();

  await page.getByRole("tab", { name: "Materials", exact: true }).click();
  await expect(page.getByRole("row").filter({ hasText: "E2E Movement Cement" })).toContainText("12 bags");
});
