import { expect, test } from "./helpers/qa-test";
import {
  provisionAndSignInToAuthEmulator,
  seedEmulatorProject,
} from "./helpers/firebase-auth-emulator";

const projectId = "demo-jobsite-jedi";
const firestoreBaseUrl = `http://127.0.0.1:8080/v1/projects/${projectId}/databases/(default)/documents`;

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

test("builder requests materials and manager completes the delivery", async ({ page }) => {
  test.setTimeout(60_000);
  page.on("pageerror", (error) => console.error(`[browser pageerror] ${error.stack ?? error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") console.error(`[browser console] ${message.text()}`);
  });

  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const password = "DeliveryTest9!";
  const builderEmail = `delivery-builder-${suffix}@example.test`;
  const managerEmail = `delivery-manager-${suffix}@example.test`;
  const projectDocumentId = `delivery-project-${suffix}`;
  const materialDocumentId = `delivery-material-${suffix}`;
  const builder = await provisionAndSignInToAuthEmulator({
    email: builderEmail,
    password,
    displayName: "Delivery E2E Builder",
    role: "builder",
  });
  const manager = await provisionAndSignInToAuthEmulator({
    email: managerEmail,
    password,
    displayName: "Delivery E2E Manager",
    role: "manager",
  });

  await seedEmulatorProject({
    projectId: projectDocumentId,
    builderId: builder.localId,
    createdBy: manager.localId,
    name: "Delivery E2E Project",
    description: "Material delivery browser fixture",
    clientName: "Delivery Client",
  });

  await createFirestoreDocument("storageMaterials", materialDocumentId, {
    name: firestoreString("E2E Cement"),
    category: firestoreString("Masonry"),
    quantity: firestoreInteger(50),
    unit: firestoreString("bags"),
    minStockLevel: firestoreInteger(5),
    createdBy: firestoreString(manager.localId),
    createdAt: firestoreTimestamp(),
    updatedAt: firestoreTimestamp(),
  }, manager.idToken);

  await page.goto("/auth");
  await page.locator("#signin-email").fill(builderEmail);
  await page.locator("#signin-password").fill(password);
  await page.getByRole("button", { name: "Sign In", exact: true }).click();
  await expect(page).toHaveURL(/\/builders$/, { timeout: 15_000 });
  await expect(page.getByRole("combobox")).toContainText("Delivery E2E Project - Delivery Client");

  await page.getByRole("button", { name: "Request materials", exact: true }).click();
  let dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: /E2E Cement/ }).click();
  await dialog.getByLabel("Quantity for E2E Cement").fill("5");
  await dialog.getByRole("button", { name: "Submit request", exact: true }).click();
  await expect(dialog.getByText("Pending", { exact: true })).toBeVisible();
  await expect(dialog.getByText("E2E Cement", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Close", exact: true }).first().click();
  await page.getByRole("button", { name: "Sign Out", exact: true }).click();

  await page.locator("#signin-email").fill(managerEmail);
  await page.locator("#signin-password").fill(password);
  await page.getByRole("button", { name: "Sign In", exact: true }).click();
  await expect(page).toHaveURL(/\/managers$/, { timeout: 15_000 });
  await page.getByRole("button", { name: "Deliveries", exact: true }).click();
  dialog = page.getByRole("dialog");
  let requestCard = dialog.locator('[data-testid="delivery-request"]').filter({ hasText: "E2E Cement" });
  await expect(requestCard).toContainText("Pending");
  await requestCard.getByRole("button", { name: "Start delivery", exact: true }).click();
  await expect(requestCard).toContainText("In progress");
  await requestCard.getByRole("button", { name: "Mark delivered", exact: true }).click();

  await dialog.getByRole("tab", { name: "Completed", exact: true }).click();
  requestCard = dialog.locator('[data-testid="delivery-request"]').filter({ hasText: "E2E Cement" });
  await expect(requestCard).toContainText("Delivered");
});
