import { expect, test } from "./helpers/qa-test";
import {
  provisionAndSignInToAuthEmulator,
  provisionEmulatorUser,
  seedEmulatorJob,
  seedEmulatorProject,
} from "./helpers/firebase-auth-emulator";

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
  const session = await provisionAndSignInToAuthEmulator({
    email,
    password,
    displayName: "E2E Builder",
    role: "builder",
  });
  const manager = await provisionEmulatorUser({
    email: `e2e-manager-${suffix}@example.test`,
    password,
    displayName: "E2E Manager",
    role: "manager",
  });

  await seedEmulatorProject({
    projectId: projectDocumentId,
    builderId: session.localId,
    createdBy: manager.uid,
    name: "E2E Evidence Project",
    description: "Browser acceptance fixture",
    clientName: "E2E Client",
    address: "Emulator Street 1",
  });
  await seedEmulatorJob({
    jobId: jobDocumentId,
    projectId: projectDocumentId,
    builderId: session.localId,
    title: "Upload completion evidence",
    description: "Attach a photo from the work area",
    section: "Exterior",
  });

  await page.goto("/auth");
  await page.locator("#signin-email").fill(email);
  await page.locator("#signin-password").fill(password);
  await page.getByRole("button", { name: "Sign In", exact: true }).click();

  await expect(page).toHaveURL(/\/builders$/, { timeout: 15_000 });
  await expect(page.getByRole("combobox")).toContainText("E2E Evidence Project - E2E Client");
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
