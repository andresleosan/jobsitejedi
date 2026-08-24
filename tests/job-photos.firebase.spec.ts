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
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}: ${body}`);
  }
  return body ? (JSON.parse(body) as T) : ({} as T);
};

const signUpBuilder = async (email: string, password: string) => {
  const created = await requestJson<AuthResponse>(
    `${authBaseUrl}/accounts:signUp?key=demo-api-key`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
    },
  );

  await requestJson(
    `${functionsBaseUrl}/ensureBuilderRole`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${created.idToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ data: { role: "builder" } }),
    },
  );

  return requestJson<AuthResponse>(
    `${authBaseUrl}/accounts:signInWithPassword?key=demo-api-key`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
    },
  );
};

const firestoreString = (value: string) => ({ stringValue: value });
const firestoreTimestamp = () => ({ timestampValue: new Date().toISOString() });

const createFirestoreDocument = async (
  collectionName: string,
  documentId: string,
  fields: Record<string, unknown>,
  idToken: string,
) => {
  await requestJson(
    `${firestoreBaseUrl}/${collectionName}?documentId=${encodeURIComponent(documentId)}`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${idToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ fields }),
    },
  );
};

test("builder uploads private evidence and submits the job for review", async ({ page }) => {
  page.on("pageerror", (error) => console.error(`[browser pageerror] ${error.stack ?? error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") console.error(`[browser console] ${message.text()}`);
  });
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const email = `e2e-builder-${suffix}@example.test`;
  const password = "BuilderTest9!";
  const projectDocumentId = `e2e-project-${suffix}`;
  const jobDocumentId = `e2e-job-${suffix}`;
  const session = await signUpBuilder(email, password);

  await createFirestoreDocument(
    "projects",
    projectDocumentId,
    {
      ownerId: firestoreString(session.localId),
      name: firestoreString("E2E Evidence Project"),
      description: firestoreString("Browser acceptance fixture"),
      clientName: firestoreString("E2E Client"),
      address: firestoreString("Emulator Street 1"),
      status: firestoreString("active"),
      createdAt: firestoreTimestamp(),
      updatedAt: firestoreTimestamp(),
    },
    session.idToken,
  );

  await createFirestoreDocument(
    "jobs",
    jobDocumentId,
    {
      projectId: firestoreString(projectDocumentId),
      builderId: firestoreString(session.localId),
      title: firestoreString("Upload completion evidence"),
      description: firestoreString("Attach a photo from the work area"),
      section: firestoreString("Exterior"),
      status: firestoreString("approved"),
      createdAt: firestoreTimestamp(),
      updatedAt: firestoreTimestamp(),
    },
    session.idToken,
  );

  await page.goto("/auth");
  await page.locator("#signin-email").fill(email);
  await page.locator("#signin-password").fill(password);
  await page.getByRole("button", { name: "Sign In", exact: true }).click();

  await expect(page).toHaveURL(/\/builders$/, { timeout: 15_000 });
  await expect(page.getByText("E2E Evidence Project")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Jobs To Do" })).toBeVisible();

  await page.getByRole("button", { name: "Upload photos for Upload completion evidence", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Private evidence")).toBeVisible();

  const onePixelPng = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64",
  );
  await dialog.getByLabel("Choose photos for this job").setInputFiles({
    name: "e2e-evidence.png",
    mimeType: "image/png",
    buffer: onePixelPng,
  });
  await expect(dialog.getByAltText("Selected photo 1")).toBeVisible();

  await dialog.getByRole("button", { name: "Upload private photos", exact: true }).click();
  await expect(dialog.getByAltText("e2e-evidence.png")).toBeVisible({ timeout: 15_000 });
  await expect(dialog.getByText("Owner and manager access")).toBeVisible();

  await dialog.getByRole("button", { name: "Submit for review", exact: true }).click();
  await expect(page.getByText("Waiting for Review")).toBeVisible({ timeout: 15_000 });
});
