import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import {
  assertAuthEmulatorOnly,
  provisionEmulatorUser,
} from "../../scripts/lib/firebase-auth-emulator.mjs";

const makeCredentials = (label: string) => ({
  email: `builder-${label}-${Date.now()}@example.test`,
  password: "Valid-password-123!",
  fullName: `Builder ${label}`,
});

const readEmulatorOobCodes = async (): Promise<Array<{ email?: string }>> => {
  const { emulatorHost, projectId } = assertAuthEmulatorOnly();
  const response = await fetch(
    `http://${emulatorHost}/emulator/v1/projects/${encodeURIComponent(projectId)}/oobCodes`,
  );
  expect(response.ok).toBe(true);
  const body = await response.json() as { oobCodes?: Array<{ email?: string }> };
  return body.oobCodes ?? [];
};

let getCurrentRole: typeof import("@/lib/firebase/auth").getCurrentRole;
let normalizeAuthError: typeof import("@/lib/firebase/auth").normalizeAuthError;
let registerWithInvitation: typeof import("@/lib/firebase/auth").registerWithInvitation;
let registerForAccess: typeof import("@/lib/firebase/auth").registerForAccess;
let signIn: typeof import("@/lib/firebase/auth").signIn;
let signOut: typeof import("@/lib/firebase/auth").signOut;
let subscribeToAuth: typeof import("@/lib/firebase/auth").subscribeToAuth;
let invitationOperations: typeof import("@/lib/firebase/functions").invitationOperations;
let accessRequestOperations: typeof import("@/lib/firebase/functions").accessRequestOperations;
let firebaseAuth: typeof import("@/lib/firebase/client").firebaseAuth;
let disableEmulatorUser: (uid: string) => Promise<void>;
let setEmulatorClaims: (uid: string, claims: Record<string, unknown>) => Promise<void>;
let readEmulatorUserByEmail: (email: string) => Promise<{
  uid: string;
  emailVerified: boolean;
  customClaims: Record<string, unknown>;
}>;

describe("Firebase Auth adapter", () => {
  beforeAll(async () => {
    vi.stubEnv("VITE_FIREBASE_USE_EMULATORS", "true");
    ({
      getCurrentRole,
      normalizeAuthError,
      registerForAccess,
      registerWithInvitation,
      signIn,
      signOut,
      subscribeToAuth,
    } = await import("@/lib/firebase/auth"));
    ({ invitationOperations, accessRequestOperations } = await import("@/lib/firebase/functions"));
    ({ firebaseAuth } = await import("@/lib/firebase/client"));
    const [{ getApps, initializeApp }, { getAuth }] = await Promise.all([
      import("../../functions/node_modules/firebase-admin/lib/app/index.js"),
      import("../../functions/node_modules/firebase-admin/lib/auth/index.js"),
    ]);
    const adminApp = getApps().find((app) => app.name === "firebase-auth-session-tests")
      ?? initializeApp({ projectId: "demo-jobsite-jedi" }, "firebase-auth-session-tests");
    const adminAuth = getAuth(adminApp);
    disableEmulatorUser = async (uid) => {
      await adminAuth.revokeRefreshTokens(uid);
      await adminAuth.updateUser(uid, { disabled: true });
    };
    setEmulatorClaims = async (uid, claims) => {
      await adminAuth.setCustomUserClaims(uid, claims);
    };
    readEmulatorUserByEmail = async (email) => {
      const user = await adminAuth.getUserByEmail(email);
      return {
        uid: user.uid,
        emailVerified: user.emailVerified,
        customClaims: { ...(user.customClaims ?? {}) },
      };
    };
  });

  beforeEach(async () => {
    await signOut();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  afterAll(async () => {
    if (signOut) {
      await signOut();
    }
    vi.unstubAllEnvs();
  });

  test("signs in a builder provisioned by the emulator fixture", async () => {
    const credentials = makeCredentials("registration");
    await provisionEmulatorUser({ ...credentials, role: "builder" });
    const user = await signIn(credentials.email, credentials.password);

    expect(user.role).toBe("builder");
    expect(user.email).toBe(credentials.email);
    expect(user.fullName).toBe(credentials.fullName);
  });

  test("signs in with valid credentials", async () => {
    const credentials = makeCredentials("sign-in");
    await provisionEmulatorUser({ ...credentials, role: "builder" });

    const user = await signIn(credentials.email, credentials.password);

    expect(user.email).toBe(credentials.email);
    expect(user.role).toBe("builder");
  });

  test("signs in an admin with the explicit admin claim", async () => {
    const credentials = makeCredentials("admin");
    await provisionEmulatorUser({ ...credentials, role: "admin" });

    const user = await signIn(credentials.email, credentials.password);

    expect(user.role).toBe("admin");
  });

  test("does not expose client helpers that can assign application roles", async () => {
    const functionsModule = await import("@/lib/firebase/functions");

    expect(functionsModule).not.toHaveProperty("ensureBuilderRole");
    expect(functionsModule).not.toHaveProperty("assignUserRole");
  });

  test("normalizes invalid credentials into a safe error", async () => {
    const credentials = makeCredentials("invalid");
    await expect(signIn(credentials.email, credentials.password)).rejects.toThrow(
      "Invalid email or password",
    );
  });

  test("keeps an authenticated identity without a role available for access requests", async () => {
    const credentials = makeCredentials("missing-role");
    await provisionEmulatorUser({ ...credentials, role: null });

    const user = await signIn(credentials.email, credentials.password);
    expect(user.role).toBeNull();
    expect(await getCurrentRole()).toBeNull();
    expect(firebaseAuth.currentUser?.email).toBe(credentials.email);
    await signOut();
  });

  test("reports a pending request and prevents requesting another role", async () => {
    const credentials = makeCredentials("pending-request");
    await provisionEmulatorUser({ ...credentials, role: null });

    await signIn(credentials.email, credentials.password);
    await expect(accessRequestOperations.submitAccessRequest({
      requestedRole: "admin",
      fullName: credentials.fullName,
    })).resolves.toMatchObject({ status: "pending", requestedRole: "admin" });
    await expect(accessRequestOperations.getAccessRequestStatus()).resolves.toEqual({
      status: "pending",
      requestedRole: "admin",
    });
    await expect(accessRequestOperations.submitAccessRequest({
      requestedRole: "builder",
      fullName: credentials.fullName,
    })).rejects.toThrow("An access request is already pending");
    await signOut();
  });

  test("registers an identity as roleless and creates an access request", async () => {
    const credentials = makeCredentials("access-registration");
    await expect(registerForAccess({
      ...credentials,
      requestedRole: "builder",
      phone: "+57 300 555 0101",
    })).resolves.toEqual({ status: "pending", requestedRole: "builder" });
    expect(firebaseAuth.currentUser).toBeNull();

    const registered = await readEmulatorUserByEmail(credentials.email);
    const reviewer = makeCredentials("access-reviewer");
    expect(registered.customClaims).toEqual({});
    await provisionEmulatorUser({ ...reviewer, role: "admin" });
    await signIn(reviewer.email, reviewer.password);
    await expect(accessRequestOperations.listAccessRequests()).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({
        email: credentials.email,
        requestedRole: "builder",
        status: "pending",
      })]),
    );
  });

  test("keeps a role claim without a current authorization grant outside the app", async () => {
    const credentials = makeCredentials("missing-grant");
    const provisioned = await provisionEmulatorUser({ ...credentials, role: "builder" });
    await setEmulatorClaims(provisioned.uid, { role: "builder" });

    const user = await signIn(credentials.email, credentials.password);
    expect(user.role).toBeNull();
    expect(await getCurrentRole()).toBeNull();
    expect(firebaseAuth.currentUser?.email).toBe(credentials.email);
    await signOut();
  });

  test.each([
    ["auth/popup-closed-by-user", "Google sign-in was cancelled"],
    ["auth/popup-blocked", "Allow pop-ups in your browser to continue with Google"],
    ["auth/account-exists-with-different-credential", "This email already uses another sign-in method"],
    ["auth/operation-not-allowed", "Google sign-in is not enabled for this application"],
    ["auth/unauthorized-domain", "This domain is not authorized for Google sign-in"],
  ])("normalizes Google error %s", (code, message) => {
    expect(normalizeAuthError({ code })).toEqual(new Error(message));
  });

  test("returns a safe response for an invalid invitation code", async () => {
    await expect(invitationOperations.validateInvitationCode("not-a-code")).resolves.toEqual({
      valid: false,
      role: null,
      expiresAt: null,
      errorMessage: "Invitation code is invalid or expired",
    });
  });

  test("completes an invitation with the shared code without sending email", async () => {
    const admin = makeCredentials("direct-activation-admin");
    const target = makeCredentials("direct-activation-target");
    await provisionEmulatorUser({ ...admin, role: "admin" });
    await signIn(admin.email, admin.password);
    const invitation = await invitationOperations.createInvitation({
      role: "builder",
      targetEmail: target.email,
    });
    await signOut();

    const registration = await registerWithInvitation({
      email: target.email,
      password: target.password,
      fullName: target.fullName,
      invitationCode: invitation.code,
    });

    expect(registration.status).toBe("complete");
    if (registration.status !== "complete") throw new Error("Expected direct invitation completion");
    expect(registration.user).toMatchObject({
      email: target.email,
      fullName: target.fullName,
      role: "builder",
    });
    expect((await readEmulatorUserByEmail(target.email)).emailVerified).toBe(true);
    expect(
      (await readEmulatorOobCodes()).some((entry) => entry.email?.toLowerCase() === target.email),
    ).toBe(false);
  }, 20_000);

  test("rejects an invitation activation for another email", async () => {
    const admin = makeCredentials("activation-admin");
    const target = makeCredentials("activation-target");
    const mismatchedTarget = makeCredentials("activation-mismatch");
    await provisionEmulatorUser({ ...admin, role: "admin" });
    await signIn(admin.email, admin.password);
    const invitation = await invitationOperations.createInvitation({
      role: "builder",
      targetEmail: target.email,
    });
    await signOut();

    await expect(registerWithInvitation({
      email: mismatchedTarget.email,
      password: mismatchedTarget.password,
      fullName: mismatchedTarget.fullName,
      invitationCode: invitation.code,
    })).rejects.toThrow("Invitation is invalid, expired, or does not match this email");

    expect(firebaseAuth.currentUser).toBeNull();
    expect((await readEmulatorUserByEmail(target.email)).customClaims).not.toHaveProperty("role");
  });

  test("rejects a builder attempting to create an invitation", async () => {
    const credentials = makeCredentials("invitation-denial");
    await provisionEmulatorUser({ ...credentials, role: "builder" });
    await signIn(credentials.email, credentials.password);

    await expect(
      invitationOperations.createInvitation({
        role: "builder",
        targetEmail: makeCredentials("invitation-target").email,
      }),
    ).rejects.toMatchObject({ code: "functions/permission-denied" });
  });

  test("signs out the current user", async () => {
    const credentials = makeCredentials("sign-out");
    await provisionEmulatorUser({ ...credentials, role: "builder" });
    await signIn(credentials.email, credentials.password);

    await signOut();

    expect(await getCurrentRole()).toBeNull();
    expect(firebaseAuth.currentUser).toBeNull();
  });

  test("rejects a refreshed session after the account is revoked and disabled", async () => {
    const credentials = makeCredentials("revoked-session");
    const provisioned = await provisionEmulatorUser({ ...credentials, role: "builder" });
    await signIn(credentials.email, credentials.password);

    await disableEmulatorUser(provisioned.uid);

    await expect(firebaseAuth.currentUser?.getIdToken(true)).rejects.toMatchObject({
      code: "auth/user-disabled",
    });
    expect(normalizeAuthError({ code: "functions/unauthenticated" }).message).toBe(
      "Your authentication session has expired",
    );
  });

  test("notifies subscribers when the session changes", async () => {
    const credentials = makeCredentials("subscription");
    const users: Array<string | null> = [];
    const unsubscribe = subscribeToAuth((user) => users.push(user?.email ?? null));

    await provisionEmulatorUser({ ...credentials, role: "builder" });
    await signIn(credentials.email, credentials.password);
    await signOut();
    unsubscribe();

    expect(users).toContain(credentials.email);
    expect(users).toContain(null);
  });
});
