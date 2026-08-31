import { expect, test } from "./helpers/qa-test";
import { provisionEmulatorUser } from "./helpers/firebase-auth-emulator";

interface ProvisionedUser {
  id: string;
  email: string;
  password: string;
  displayName: string;
}

const provisionUser = async (
  label: string,
  role: "manager" | "builder",
  suffix: string,
): Promise<ProvisionedUser> => {
  const password = "AssignmentE2E9!";
  const displayName = `Assignment E2E ${label}`;
  const email = `assignment-e2e-${label}-${suffix}@example.test`;
  const user = await provisionEmulatorUser({ email, password, displayName, role });
  return { id: user.uid, email, password, displayName };
};

const signIn = async (page: import("@playwright/test").Page, user: ProvisionedUser) => {
  await page.locator("#signin-email").fill(user.email);
  await page.locator("#signin-password").fill(user.password);
  await page.getByRole("button", { name: "Sign In", exact: true }).click();
};

test("manager assigns a project and job that only the selected builder can see", async ({ page }) => {
  const browserErrors: string[] = [];
  page.on("pageerror", (error) => browserErrors.push(error.stack ?? error.message));
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(message.text());
  });

  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const [manager, assignedBuilder, otherBuilder] = await Promise.all([
    provisionUser("manager", "manager", suffix),
    provisionUser("builder-one", "builder", suffix),
    provisionUser("builder-two", "builder", suffix),
  ]);
  const projectName = `Assignment Project ${suffix}`;
  const jobName = `Assigned framing ${suffix}`;

  await page.goto("/auth");
  await signIn(page, manager);
  await expect(page).toHaveURL(/\/managers$/, { timeout: 15_000 });
  await page.getByRole("button", { name: "New project", exact: true }).click();

  let dialog = page.getByRole("dialog");
  await dialog.getByRole("combobox", { name: "Assigned builder", exact: true }).click();
  await page.getByRole("option", { name: new RegExp(assignedBuilder.displayName) }).click();
  await dialog.getByLabel("Project Name").fill(projectName);
  await dialog.getByLabel("Client Name").fill("Assignment Browser Client");
  await dialog.getByLabel("Description").fill("Manager-created project with an explicit builder assignment");
  await dialog.getByRole("button", { name: "Create Project", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("heading", { name: projectName, exact: true })).toBeVisible({ timeout: 15_000 });

  await page.getByRole("heading", { name: projectName, exact: true }).click();
  await expect(page).toHaveURL(/\/project\//, { timeout: 15_000 });
  await page.getByRole("button", { name: "Add job", exact: true }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("Job Title").fill(jobName);
  await dialog.getByLabel("Description").fill("This work belongs to the project's assigned builder");
  await dialog.getByRole("button", { name: "Create Job", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("heading", { name: jobName, exact: true })).toBeVisible({ timeout: 15_000 });

  await page.getByRole("button", { name: "Back to dashboard", exact: true }).click();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await signIn(page, assignedBuilder);
  await expect(page).toHaveURL(/\/builders$/, { timeout: 15_000 });
  await expect(page.getByRole("combobox", { name: "Current project", exact: true })).toContainText(projectName);
  await expect(page.getByText(jobName, { exact: true })).toBeVisible({ timeout: 15_000 });

  await page.getByRole("button", { name: "Sign Out", exact: true }).click();
  await signIn(page, otherBuilder);
  await expect(page).toHaveURL(/\/builders$/, { timeout: 15_000 });
  await expect(page.getByRole("combobox", { name: "Current project", exact: true })).not.toContainText(projectName);
  await expect(page.getByText(jobName, { exact: true })).toHaveCount(0);
  expect(browserErrors).toEqual([]);
});
