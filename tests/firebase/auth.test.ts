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

let getCurrentRole: typeof import("@/lib/firebase/auth").getCurrentRole;
let completeInvitationRegistration: typeof import("@/lib/firebase/auth").completeInvitationRegistration;
let normalizeAuthError: typeof import("@/lib/firebase/auth").normalizeAuthError;
let registerWithInvitation: typeof import("@/lib/firebase/auth").registerWithInvitation;
let requestInvitationActivation: typeof import("@/lib/firebase/auth").requestInvitationActivation;
let signIn: typeof import("@/lib/firebase/auth").signIn;
let signOut: typeof import("@/lib/firebase/auth").signOut;
let subscribeToAuth: typeof import("@/lib/firebase/auth").subscribeToAuth;
let invitationOperations: typeof import("@/lib/firebase/functions").invitationOperations;
let firebaseAuth: typeof import("@/lib/firebase/client").firebaseAuth;
let applyActionCode: typeof import("firebase/auth").applyActionCode;
let confirmPasswordReset: typeof import("firebase/auth").confirmPasswordReset;
let disableEmulatorUser: (uid: string) => Promise<void>;
let setEmulatorClaims: (uid: string, claims: Record<string, unknown>) => Promise<void>;
let readEmulatorUserByEmail: (email: string) => Promise<{
  uid: string;
  emailVerified: boolean;
  customClaims: Record<string, unknown>;
}>;

interface EmulatorOobCode {
  email?: string;
  requestType?: string;
  oobCode?: string;
  oobLink?: string;
}

const readEmulatorOobCodes = async (): Promise<EmulatorOobCode[]> => {
  const { emulatorHost, projectId } = assertAuthEmulatorOnly();
  const response = await fetch(
    `http://${emulatorHost}/emulator/v1/projects/${encodeURIComponent(projectId)}/oobCodes`,
  );
  expect(response.ok).toBe(true);

  const body = await response.json() as { oobCodes?: EmulatorOobCode[] };
  return body.oobCodes ?? [];
};

const readLatestEmulatorOobCode = async (
  email: string,
  requestType: "PASSWORD_RESET" | "VERIFY_EMAIL",
): Promise<Required<Pick<EmulatorOobCode, "email" | "requestType" | "oobCode" | "oobLink">>> => {
  const request = [...await readEmulatorOobCodes()].reverse().find(
    (entry) => (
      entry.email?.toLowerCase() === email.toLowerCase()
      && entry.requestType === requestType
    ),
  );
  expect(request).toMatchObject({
    email,
    requestType,
    oobCode: expect.any(String),
    oobLink: expect.any(String),
  });
  if (!request?.email || !request.oobCode || !request.oobLink) {
    throw new Error(`Expected a complete ${requestType} OOB record for ${email}`);
  }
  return {
    email: request.email,
    requestType,
    oobCode: request.oobCode,
    oobLink: request.oobLink,
  };
};

describe("Firebase Auth adapter", () => {
  beforeAll(async () => {
    vi.stubEnv("VITE_FIREBASE_USE_EMULATORS", "true");
    ({
      completeInvitationRegistration,
      getCurrentRole,
      normalizeAuthError,
      registerWithInvitation,
      requestInvitationActivation,
      signIn,
      signOut,
      subscribeToAuth,
    } = await import("@/lib/firebase/auth"));
    ({ invitationOperations } = await import("@/lib/firebase/functions"));
    ({ firebaseAuth } = await import("@/lib/firebase/client"));
    ({ applyActionCode, confirmPasswordReset } = await import("firebase/auth"));
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

  test("rejects and signs out an authenticated identity without an application role", async () => {
    const credentials = makeCredentials("missing-role");
    await provisionEmulatorUser({ ...credentials, role: null });

    await expect(signIn(credentials.email, credentials.password)).rejects.toThrow(
      "This account has no assigned BuildTrack role. Contact an administrator",
    );
    expect(await getCurrentRole()).toBeNull();
    expect(firebaseAuth.currentUser).toBeNull();
  });

  test("rejects and signs out a role claim without a current authorization grant", async () => {
    const credentials = makeCredentials("missing-grant");
    const provisioned = await provisionEmulatorUser({ ...credentials, role: "builder" });
    await setEmulatorClaims(provisioned.uid, { role: "builder" });

    await expect(signIn(credentials.email, credentials.password)).rejects.toThrow(
      "This account has no assigned BuildTrack role. Contact an administrator",
    );
    expect(await getCurrentRole()).toBeNull();
    expect(firebaseAuth.currentUser).toBeNull();
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

  test("validates the invitation target before sending a password-reset activation link", async () => {
    const admin = makeCredentials("activation-admin");
    const target = makeCredentials("activation-target");
    const mismatchedTarget = makeCredentials("activation-mismatch");
    await provisionEmulatorUser({ ...admin, role: "admin" });
    await provisionEmulatorUser({ ...mismatchedTarget, role: null, emailVerified: false });
    await signIn(admin.email, admin.password);
    const invitation = await invitationOperations.createInvitation({
      role: "builder",
      targetEmail: target.email,
    });
    await signOut();

    const appOrigin = "http://127.0.0.1:8080";
    vi.stubGlobal("window", { location: { origin: appOrigin } });

    await expect(requestInvitationActivation({
      email: mismatchedTarget.email,
      invitationCode: invitation.code,
    })).rejects.toThrow("Invitation is invalid, expired, or does not match this email");

    expect(
      (await readEmulatorOobCodes()).some(
        (entry) => entry.email?.toLowerCase() === mismatchedTarget.email.toLowerCase(),
      ),
    ).toBe(false);

    await requestInvitationActivation({
      email: ` ${target.email.toUpperCase()} `,
      invitationCode: ` ${invitation.code.toLowerCase()} `,
    });

    const resetRequest = await readLatestEmulatorOobCode(target.email, "PASSWORD_RESET");

    const providerLink = new URL(resetRequest.oobLink);
    const decodedProviderLink = decodeURIComponent(providerLink.toString());
    expect(decodedProviderLink).not.toContain(invitation.code);
    expect(decodedProviderLink).not.toContain(target.email);
    const continueUrlValue = providerLink.searchParams.get("continueUrl");
    expect(continueUrlValue).not.toBeNull();
    const continueUrl = new URL(continueUrlValue ?? "");
    expect(continueUrl.origin).toBe(appOrigin);
    expect(continueUrl.pathname).toBe("/auth");
    expect(continueUrl.search).toBe("");
    expect(continueUrl.hash).toBe("");
    expect(decodeURIComponent(continueUrl.toString())).not.toContain(invitation.code);
    expect(decodeURIComponent(continueUrl.toString())).not.toContain(target.email);
  });

  test("rejects a guessed password before the pre-created account completes reset", async () => {
    const admin = makeCredentials("pre-reset-admin");
    const target = makeCredentials("pre-reset-target");
    await provisionEmulatorUser({ ...admin, role: "admin" });
    await signIn(admin.email, admin.password);
    const invitation = await invitationOperations.createInvitation({
      role: "builder",
      targetEmail: target.email,
    });
    const precreatedTarget = await readEmulatorUserByEmail(target.email);
    expect(precreatedTarget.customClaims).toMatchObject({
      invitationEnrollmentId: expect.stringMatching(/^[a-f0-9]{32}$/),
    });
    expect(precreatedTarget.customClaims).not.toHaveProperty("role");
    await signOut();

    await expect(registerWithInvitation({
      email: target.email,
      password: target.password,
      fullName: target.fullName,
      invitationCode: invitation.code,
    })).rejects.toThrow("Invalid email or password");

    expect(firebaseAuth.currentUser).toBeNull();
    const unchangedTarget = await readEmulatorUserByEmail(target.email);
    expect(unchangedTarget.uid).toBe(precreatedTarget.uid);
    expect(unchangedTarget.customClaims).toEqual(precreatedTarget.customClaims);
  });

  test("completes reset, verification, and registration on the pre-created account", async () => {
    const admin = makeCredentials("provider-activation-admin");
    const target = makeCredentials("provider-activation-target");
    await provisionEmulatorUser({ ...admin, role: "admin" });
    await signIn(admin.email, admin.password);
    const invitation = await invitationOperations.createInvitation({
      role: "builder",
      targetEmail: target.email,
    });
    const precreatedTarget = await readEmulatorUserByEmail(target.email);
    expect(precreatedTarget.emailVerified).toBe(false);
    expect(precreatedTarget.customClaims).toMatchObject({
      invitationEnrollmentId: expect.stringMatching(/^[a-f0-9]{32}$/),
    });
    expect(precreatedTarget.customClaims).not.toHaveProperty("role");
    await signOut();

    vi.stubGlobal("window", { location: { origin: "http://127.0.0.1:8080" } });
    await requestInvitationActivation({
      email: target.email,
      invitationCode: invitation.code,
    });
    const resetRequest = await readLatestEmulatorOobCode(target.email, "PASSWORD_RESET");
    await confirmPasswordReset(firebaseAuth, resetRequest.oobCode, target.password);

    const registration = await registerWithInvitation({
      email: target.email,
      password: target.password,
      fullName: target.fullName,
      invitationCode: invitation.code,
    });

    let completedUser;
    if (registration.status === "verification-required") {
      const verificationRequest = await readLatestEmulatorOobCode(target.email, "VERIFY_EMAIL");
      await applyActionCode(firebaseAuth, verificationRequest.oobCode);
      completedUser = await completeInvitationRegistration({
        invitationCode: invitation.code,
      });
    } else {
      completedUser = registration.user;
    }

    expect(completedUser).toMatchObject({
      id: precreatedTarget.uid,
      email: target.email,
      role: "builder",
    });
    expect(firebaseAuth.currentUser?.uid).toBe(precreatedTarget.uid);
    const finalToken = await firebaseAuth.currentUser?.getIdTokenResult(true);
    expect(finalToken?.claims.role).toBe("builder");
    expect(finalToken?.claims).not.toHaveProperty("invitationEnrollmentId");

    const finalTarget = await readEmulatorUserByEmail(target.email);
    expect(finalTarget.uid).toBe(precreatedTarget.uid);
    expect(finalTarget.emailVerified).toBe(true);
    expect(finalTarget.customClaims.role).toBe("builder");
    expect(finalTarget.customClaims).not.toHaveProperty("invitationEnrollmentId");
  });

  test("surfaces the email verification requirement without exposing backend details", () => {
    expect(normalizeAuthError({
      code: "functions/failed-precondition",
      details: { reason: "email-not-verified" },
    })).toEqual(new Error("Verify your email before accepting the invitation"));
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
