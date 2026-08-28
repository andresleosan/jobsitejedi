import { expect, test } from "@playwright/test";

const authBaseUrl = "http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1";

const createUnassignedAccount = async (email: string, password: string) => {
  const response = await fetch(`${authBaseUrl}/accounts:signUp?key=demo-api-key`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });

  if (!response.ok) {
    throw new Error(`Unable to create Auth Emulator fixture: ${response.status}`);
  }
};

test("login offers Google and rejects an identity without a BuildTrack role without redirect loops", async ({ page }) => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const email = `e2e-unassigned-${suffix}@example.test`;
  const password = "UnassignedTest9!";
  const transitions: string[] = [];

  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) transitions.push(frame.url());
  });

  await createUnassignedAccount(email, password);
  await page.goto("/auth");

  await expect(page.getByRole("button", { name: "Continue with Google", exact: true })).toBeVisible();
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign In", exact: true }).click();

  await expect(page.getByText("This account has no assigned BuildTrack role. Contact a manager", { exact: true })).toBeVisible();
  await expect(page.getByText("La cuenta no tiene un rol asignado", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Cerrar sesi\u00f3n", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Reintentar", exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/auth$/);
  await page.waitForTimeout(500);

  const authTransitions = transitions.filter((url) => /\/auth(?:\?|$)/.test(url));
  expect(transitions.some((url) => /\/dashboard(?:\?|$)/.test(url))).toBe(false);
  expect(authTransitions.length).toBeLessThanOrEqual(2);

  await page.getByRole("button", { name: "Reintentar", exact: true }).click();
  await expect(page.getByLabel("Email", { exact: true })).toBeFocused();
  await expect(page.getByLabel("Email", { exact: true })).toHaveValue("");
  await expect(page.getByLabel("Password", { exact: true })).toHaveValue("");
  await expect(page.getByText("La cuenta no tiene un rol asignado", { exact: true })).toHaveCount(0);
});
