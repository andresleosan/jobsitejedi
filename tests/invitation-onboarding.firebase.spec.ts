import { expect, test } from "./helpers/qa-test";
import {
  assertAuthEmulatorOnly,
  assertFirestoreEmulatorOnly,
  provisionEmulatorUser,
} from "../scripts/lib/firebase-auth-emulator.mjs";

const PENDING_INVITATION_STORAGE_KEY = "buildtrack.pendingInvitation";

const getEmulatorAdminApp = async () => {
  const { projectId } = assertAuthEmulatorOnly();
  const { getApps, initializeApp } = await import(
    "../functions/node_modules/firebase-admin/lib/app/index.js"
  );
  const appName = "invitation-onboarding-e2e-admin";
  const existingApp = getApps().find((app) => app.name === appName);
  if (existingApp && existingApp.options.projectId !== projectId) {
    throw new Error("Invitation onboarding Admin fixture uses an unexpected project");
  }
  return existingApp ?? initializeApp({ projectId }, appName);
};

const getEmulatorAdminAuth = async () => {
  const [{ getAuth }, app] = await Promise.all([
    import("../functions/node_modules/firebase-admin/lib/auth/index.js"),
    getEmulatorAdminApp(),
  ]);
  return getAuth(app);
};

const readAdminUserByEmail = async (email: string) =>
  (await getEmulatorAdminAuth()).getUserByEmail(email);

const readAdminAuthorizationGrant = async (uid: string) => {
  assertFirestoreEmulatorOnly();
  const [{ getFirestore }, app] = await Promise.all([
    import("../functions/node_modules/firebase-admin/lib/firestore/index.js"),
    getEmulatorAdminApp(),
  ]);
  const snapshot = await getFirestore(app).collection("authorizationGrants").doc(uid).get();
  return snapshot.exists ? snapshot.data() ?? null : null;
};

test("manager securely onboards an invited builder without email delivery", async ({ page }) => {
  const onboardingStartedAt = Date.now();
  const suffix = `${onboardingStartedAt}-${Math.random().toString(36).slice(2, 8)}`;
  const managerEmail = `onboarding-manager-${suffix}@example.test`;
  const builderEmail = `onboarding-builder-${suffix}@example.test`;
  const unrelatedEmail = `onboarding-unrelated-${suffix}@example.test`;
  const managerPassword = "ManagerOnboarding9!";
  const builderPassword = "BuilderOnboarding9!";

  await provisionEmulatorUser({
    email: managerEmail,
    password: managerPassword,
    displayName: "Onboarding E2E Manager",
    fullName: "Onboarding E2E Manager",
    role: "manager",
  });

  await page.goto("/auth");
  await page.getByLabel("Email", { exact: true }).fill(managerEmail);
  await page.getByLabel("Password", { exact: true }).fill(managerPassword);
  await page.getByRole("button", { name: "Sign In", exact: true }).click();
  await expect(page).toHaveURL(/\/managers$/);

  await page.getByRole("link", { name: "Invite member", exact: true }).click();
  await expect(page).toHaveURL(/\/invite$/);
  await page.getByRole("combobox").click();
  await page.getByRole("option", { name: "Builder", exact: true }).click();
  await page.getByLabel("Invitee email", { exact: true }).fill(builderEmail);
  await page.getByRole("button", { name: "Generate QR Code", exact: true }).click();

  const codeLocator = page.getByText(/^[A-Z0-9]{12}$/, { exact: true });
  await expect(codeLocator).toBeVisible();
  const invitationCode = (await codeLocator.textContent())?.trim() ?? "";
  expect(invitationCode).toMatch(/^[A-Z0-9]{12}$/);

  const placeholder = await readAdminUserByEmail(builderEmail);
  expect(placeholder.customClaims?.role).toBeUndefined();
  expect(placeholder.customClaims?.invitationEnrollmentId).toMatch(/^[a-f0-9]{32}$/);

  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page).toHaveURL(/\/managers$/);
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page).toHaveURL(/\/auth$/);

  await page.goto(`/auth#code=${encodeURIComponent(invitationCode)}`);
  await expect(page).toHaveURL(/\/auth$/);
  await expect(page.getByText(/Valid invitation for builder/)).toBeVisible();

  const sanitizedInvitationUrl = new URL(page.url());
  expect({
    pathname: sanitizedInvitationUrl.pathname,
    search: sanitizedInvitationUrl.search,
    hash: sanitizedInvitationUrl.hash,
  }).toEqual({ pathname: "/auth", search: "", hash: "" });

  const pendingInvitationRaw = await page.evaluate(
    (storageKey) => window.sessionStorage.getItem(storageKey),
    PENDING_INVITATION_STORAGE_KEY,
  );
  expect(pendingInvitationRaw).not.toBeNull();
  const pendingInvitation = JSON.parse(pendingInvitationRaw ?? "null") as {
    code?: unknown;
    expiresAt?: unknown;
  } | null;
  expect(pendingInvitation).not.toBeNull();
  expect(Object.keys(pendingInvitation ?? {}).sort()).toEqual(["code", "expiresAt"]);
  expect(pendingInvitation?.code).toBe(invitationCode);
  expect(pendingInvitation?.expiresAt).toEqual(expect.any(Number));
  expect(pendingInvitation?.expiresAt as number).toBeGreaterThan(Date.now());

  await page.reload();
  await expect(page).toHaveURL(/\/auth$/);
  await expect(page.getByText(/Valid invitation for builder/)).toBeVisible();
  const reloadedPendingInvitation = JSON.parse(
    await page.evaluate(
      (storageKey) => window.sessionStorage.getItem(storageKey) ?? "null",
      PENDING_INVITATION_STORAGE_KEY,
    ),
  ) as { code?: unknown; expiresAt?: unknown } | null;
  expect(reloadedPendingInvitation).toEqual(pendingInvitation);

  const signupEmail = page.getByLabel("Email *", { exact: true });
  await signupEmail.fill(unrelatedEmail);
  await page.getByLabel("Full Name *", { exact: true }).fill("Unrelated E2E User");
  await page.getByLabel("Password *", { exact: true }).fill(builderPassword);
  await page.getByRole("button", { name: "Create Account as Builder", exact: true }).click();
  await expect(page.getByText("Sign up failed", { exact: true })).toBeVisible();
  await expect(page.getByText(
    "Invitation is invalid, expired, or does not match this email",
    { exact: true },
  )).toBeVisible();

  await signupEmail.fill(builderEmail);
  await page.getByLabel("Full Name *", { exact: true }).fill("Onboarding E2E Builder");
  await page.getByLabel("Password *", { exact: true }).fill(builderPassword);
  await page.getByRole("button", { name: "Create Account as Builder", exact: true }).click();
  await expect(page).toHaveURL(/\/builders$/);

  await expect.poll(
    async () => page.evaluate(
      (storageKey) => window.sessionStorage.getItem(storageKey),
      PENDING_INVITATION_STORAGE_KEY,
    ),
    { message: "Expected invitation handoff state to be removed after onboarding" },
  ).toBeNull();

  await expect.poll(
    async () => (await readAdminUserByEmail(builderEmail)).customClaims?.role ?? null,
    { message: "Expected the invited account to receive the builder claim" },
  ).toBe("builder");
  const completedBuilder = await readAdminUserByEmail(builderEmail);
  expect(completedBuilder.uid).toBe(placeholder.uid);
  expect(completedBuilder.emailVerified).toBe(true);
  expect(completedBuilder.customClaims?.role).toBe("builder");
  expect(completedBuilder.customClaims ?? {}).not.toHaveProperty("invitationEnrollmentId");

  const authorizationGrantId = completedBuilder.customClaims?.authorizationGrantId;
  if (typeof authorizationGrantId !== "string") {
    throw new Error("Invited builder is missing the authorization grant claim");
  }
  expect(authorizationGrantId).toMatch(/^[a-f0-9]{32}$/);

  const authorizationGrant = await readAdminAuthorizationGrant(completedBuilder.uid);
  if (!authorizationGrant) {
    throw new Error("Invited builder is missing the authorization grant document");
  }
  expect(Object.keys(authorizationGrant).sort()).toEqual([
    "active",
    "grantId",
    "role",
    "updatedAt",
  ]);
  expect(authorizationGrant.active).toBe(true);
  expect(authorizationGrant.role).toBe("builder");
  expect(authorizationGrant.grantId).toBe(authorizationGrantId);
  const { Timestamp } = await import(
    "../functions/node_modules/firebase-admin/lib/firestore/index.js"
  );
  expect(authorizationGrant.updatedAt).toBeInstanceOf(Timestamp);
  if (!(authorizationGrant.updatedAt instanceof Timestamp)) {
    throw new Error("Authorization grant updatedAt is not a Firestore Timestamp");
  }
  const authorizationGrantUpdatedAt = authorizationGrant.updatedAt.toMillis();
  expect(authorizationGrantUpdatedAt).toBeGreaterThanOrEqual(onboardingStartedAt);
  expect(authorizationGrantUpdatedAt).toBeLessThanOrEqual(Date.now());

  await page.evaluate(
    ({ storageKey, code }) => window.sessionStorage.setItem(storageKey, JSON.stringify({
      code,
      expiresAt: Date.now() + 60_000,
    })),
    { storageKey: PENDING_INVITATION_STORAGE_KEY, code: invitationCode },
  );
  await page.getByRole("button", { name: "Sign Out", exact: true }).click();
  await expect(page).toHaveURL(/\/auth$/);
  await expect(page.getByText("Invitation code is invalid or expired", { exact: true })).toBeVisible();
  await expect.poll(
    async () => page.evaluate(
      (storageKey) => window.sessionStorage.getItem(storageKey),
      PENDING_INVITATION_STORAGE_KEY,
    ),
    { message: "Expected invalid invitation handoff state to be removed" },
  ).toBeNull();
});
