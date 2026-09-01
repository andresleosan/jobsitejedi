import { expect, test } from "@playwright/test";
import { provisionEmulatorUser } from "../scripts/lib/firebase-auth-emulator.mjs";

test("the three documented QA accounts can sign in through the UI", async ({ page }) => {
  const password = process.env.QA_TEST_PASSWORD;
  test.skip(!password, "Set QA_TEST_PASSWORD to run the shared QA-account check");
  const qaPassword = password ?? "";

  const accounts = [
    { email: "admin@admin.com", role: "admin", name: "QA Admin", path: "/admins" },
    { email: "manager@manager.com", role: "manager", name: "QA Manager", path: "/managers" },
    { email: "builder@builder.com", role: "builder", name: "QA Builder", path: "/builders" },
  ] as const;

  for (const account of accounts) {
    await provisionEmulatorUser({
      email: account.email,
      password: qaPassword,
      displayName: account.name,
      fullName: account.name,
      role: account.role,
    });

    await page.goto("/auth");
    await page.getByLabel("Email", { exact: true }).fill(account.email);
    await page.getByLabel("Password", { exact: true }).fill(qaPassword);
    await page.getByRole("button", { name: "Sign In", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${account.path}$`));

    await page.getByRole("button", { name: /Sign out/i }).click();
    await expect(page).toHaveURL(/\/auth$/);
  }
});
