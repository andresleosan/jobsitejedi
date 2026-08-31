import { readFile } from "node:fs/promises";
import { expect, test } from "./helpers/qa-test";
import {
  provisionAndSignInToAuthEmulator,
  seedEmulatorJob,
  seedEmulatorProject,
  seedEmulatorTimeEntry,
} from "./helpers/firebase-auth-emulator";

const firebaseProjectId = "demo-jobsite-jedi";
const firestoreBaseUrl = `http://127.0.0.1:8080/v1/projects/${firebaseProjectId}/databases/(default)/documents`;

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

test("manager uses Firebase project details and exports a safe activity ledger", async ({ page }) => {
  test.setTimeout(60_000);
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const password = "ReportingTest9!";
  const builderEmail = `reporting-builder-${suffix}@example.test`;
  const managerEmail = `reporting-manager-${suffix}@example.test`;
  const projectDocumentId = `reporting-project-${suffix}`;
  const builder = await provisionAndSignInToAuthEmulator({
    email: builderEmail,
    password,
    displayName: "Reporting E2E Builder",
    role: "builder",
  });
  const manager = await provisionAndSignInToAuthEmulator({
    email: managerEmail,
    password,
    displayName: "Reporting E2E Manager",
    role: "manager",
  });

  await seedEmulatorProject({
    projectId: projectDocumentId,
    builderId: builder.localId,
    createdBy: manager.localId,
    name: "Reporting E2E Project",
    description: "Firebase reporting browser fixture",
    clientName: "Reporting Client",
    address: "Ledger Street 7",
  });

  await seedEmulatorJob({
    jobId: `completed-job-${suffix}`,
    projectId: projectDocumentId,
    builderId: builder.localId,
    title: "Completed ledger fixture",
    status: "completed",
    reviewedBy: manager.localId,
    reviewedAt: new Date(),
  });

  const clockOut = new Date();
  const clockIn = new Date(clockOut.getTime() - 90 * 60_000);
  await seedEmulatorTimeEntry({
    entryId: `time-entry-${suffix}`,
    projectId: projectDocumentId,
    builderId: builder.localId,
    clockIn,
    clockOut,
    notes: "\t=HYPERLINK(\"https://invalid.example\",\"unsafe\")",
  });

  await page.goto("/auth");
  await page.locator("#signin-email").fill(managerEmail);
  await page.locator("#signin-password").fill(password);
  await page.getByRole("button", { name: "Sign In", exact: true }).click();
  await expect(page).toHaveURL(/\/managers$/, { timeout: 15_000 });

  await page.getByRole("heading", { name: "Reporting E2E Project", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/project/${projectDocumentId}$`));
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
