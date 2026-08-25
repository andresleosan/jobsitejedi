import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";

const credentials = (label: string) => ({
  email: `functions-${label}-${Date.now()}@example.test`,
  password: "Valid-password-123!",
  fullName: `Functions ${label}`,
});

let adminAuth: typeof import("../../functions/node_modules/firebase-admin/lib/auth/index.js").getAuth extends (
  ...args: infer Args
) => infer Result
  ? (...args: Args) => Result
  : never;
let registerBuilder: typeof import("@/lib/firebase/auth").registerBuilder;
let registerWithInvitation: typeof import("@/lib/firebase/auth").registerWithInvitation;
let signIn: typeof import("@/lib/firebase/auth").signIn;
let signOut: typeof import("@/lib/firebase/auth").signOut;
let invitationOperations: typeof import("@/lib/firebase/functions").invitationOperations;

describe("Firebase invitation Functions", () => {
  beforeAll(async () => {
    vi.stubEnv("VITE_FIREBASE_USE_EMULATORS", "true");
    const [{ getApps, initializeApp }, { getAuth }] = await Promise.all([
      import("../../functions/node_modules/firebase-admin/lib/app/index.js"),
      import("../../functions/node_modules/firebase-admin/lib/auth/index.js"),
    ]);
    const adminApp = getApps().find((app) => app.name === "firebase-invitation-tests")
      ?? initializeApp({ projectId: "demo-jobsite-jedi" }, "firebase-invitation-tests");
    adminAuth = getAuth(adminApp);
    ({ registerBuilder, registerWithInvitation, signIn, signOut } = await import("@/lib/firebase/auth"));
    ({ invitationOperations } = await import("@/lib/firebase/functions"));
  });

  afterAll(async () => {
    await signOut();
    vi.unstubAllEnvs();
  });

  test("creates, validates, consumes once and rejects a second consumption", async () => {
    const managerCredentials = credentials("manager");
    const manager = await registerBuilder(managerCredentials);
    await adminAuth.setCustomUserClaims(manager.id, { role: "manager" });
    await signOut();
    await signIn(managerCredentials.email, managerCredentials.password);

    const invitation = await invitationOperations.createInvitation({ role: "builder" });
    expect(invitation.code).toMatch(/^[A-Z0-9]{12}$/);
    const validation = await invitationOperations.validateInvitationCode(invitation.code);
    expect(validation).toMatchObject({ valid: true, role: "builder" });

    await signOut();
    const builderCredentials = credentials("invited-builder");
    const invitedBuilder = await registerWithInvitation({
      ...builderCredentials,
      invitationId: validation.invitationId,
    });
    expect(invitedBuilder.role).toBe("builder");

    await expect(
      invitationOperations.consumeInvitation({
        invitationId: validation.invitationId,
        userId: invitedBuilder.id,
      }),
    ).rejects.toMatchObject({ code: "functions/failed-precondition" });
  }, 15_000);
});
