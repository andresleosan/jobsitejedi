import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

const firebaseProjectId = "demo-jobsite-jedi";
const authBaseUrl = "http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1";
const firestoreBaseUrl = `http://127.0.0.1:8080/v1/projects/${firebaseProjectId}/databases/(default)/documents`;
const functionsBaseUrl = `http://127.0.0.1:5001/${firebaseProjectId}/europe-west1`;

interface AuthResponse {
  idToken: string;
  localId: string;
}

interface FirestoreListResponse {
  documents?: Array<{
    fields?: Record<string, { stringValue?: string }>;
  }>;
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
  const adminApp = getApps().find((app) => app.name === "reporting-browser-tests")
    ?? initializeApp({ projectId: firebaseProjectId }, "reporting-browser-tests");
  await getAuth(adminApp).setCustomUserClaims(userId, { role: "manager" });
};

const firestoreString = (value: string) => ({ stringValue: value });
const firestoreTimestamp = (value = new Date()) => ({ timestampValue: value.toISOString() });

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

test("manager uses Firebase project details and exports a safe activity ledger", async ({ page }) => {
  test.setTimeout(60_000);
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const password = "ReportingTest9!";
  const builderEmail = `reporting-builder-${suffix}@example.test`;
  const managerEmail = `reporting-manager-${suffix}@example.test`;
  const projectDocumentId = `reporting-project-${suffix}`;
  const builder = await signUpBuilder(builderEmail, password, "Reporting E2E Builder");
  const managerBuilder = await signUpBuilder(managerEmail, password, "Reporting E2E Manager");
  await promoteToManager(managerBuilder.localId);
  const manager = await signIn(managerEmail, password);

  await createFirestoreDocument("projects", projectDocumentId, {
    ownerId: firestoreString(builder.localId),
    name: firestoreString("Reporting E2E Project"),
    description: firestoreString("Firebase reporting browser fixture"),
    clientName: firestoreString("Reporting Client"),
    address: firestoreString("Ledger Street 7"),
    status: firestoreString("active"),
    createdAt: firestoreTimestamp(),
    updatedAt: firestoreTimestamp(),
  }, builder.idToken);

  await createFirestoreDocument("jobs", `completed-job-${suffix}`, {
    projectId: firestoreString(projectDocumentId),
    builderId: firestoreString(builder.localId),
    title: firestoreString("Completed ledger fixture"),
    status: firestoreString("completed"),
    reviewedAt: firestoreTimestamp(),
    createdAt: firestoreTimestamp(),
    updatedAt: firestoreTimestamp(),
  }, manager.idToken);

  const clockOut = new Date();
  const clockIn = new Date(clockOut.getTime() - 90 * 60_000);
  await createFirestoreDocument("timeTracking", `time-entry-${suffix}`, {
    projectId: firestoreString(projectDocumentId),
    builderId: firestoreString(builder.localId),
    clockIn: firestoreTimestamp(clockIn),
    clockOut: firestoreTimestamp(clockOut),
    notes: firestoreString("\t=HYPERLINK(\"https://invalid.example\",\"unsafe\")"),
  }, manager.idToken);

  await page.goto("/auth");
  await page.locator("#signin-email").fill(managerEmail);
  await page.locator("#signin-password").fill(password);
  await page.getByRole("button", { name: "Sign In", exact: true }).click();
  await expect(page).toHaveURL(/\/managers$/, { timeout: 15_000 });

  await page.goto(`/project/${projectDocumentId}`);
  await expect(page.getByRole("heading", { name: "Reporting E2E Project" })).toBeVisible();
  await expect(page.getByText("Completed ledger fixture")).toBeVisible();
  await page.getByRole("button", { name: "Add job", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Job Title *").fill("Manager assigned Firebase job");
  await dialog.getByRole("button", { name: "Create Job", exact: true }).click();
  await expect(page.getByText("Manager assigned Firebase job")).toBeVisible({ timeout: 15_000 });

  const jobs = await requestJson<FirestoreListResponse>(`${firestoreBaseUrl}/jobs?pageSize=100`, {
    headers: { authorization: `Bearer ${manager.idToken}` },
  });
  const assigned = jobs.documents?.find((document) =>
    document.fields?.title?.stringValue === "Manager assigned Firebase job");
  expect(assigned?.fields?.builderId?.stringValue).toBe(builder.localId);

  await page.getByRole("button", { name: "Project statements", exact: true }).click();
  await expect(page).toHaveURL(/\/statements$/);
  await expect(page.getByRole("heading", { name: "Site statements" })).toBeVisible();
  await page.getByLabel("Statement project", { exact: true }).click();
  await page.getByRole("option", { name: "Reporting E2E Project", exact: true }).click();
  await expect(page.getByTestId("statement-row")).toHaveCount(2);
  await expect(page.getByRole("cell", { name: "1.50 h", exact: true })).toBeVisible();

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export CSV", exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^jobsite-statements-\d{4}-\d{2}-\d{2}\.csv$/);
  const downloadPath = await download.path();
  expect(downloadPath).toBeTruthy();
  const csv = await readFile(downloadPath as string, "utf8");
  expect(csv).toContain("\"'\t=HYPERLINK(\"\"https://invalid.example\"\",\"\"unsafe\"\")\"");
});
