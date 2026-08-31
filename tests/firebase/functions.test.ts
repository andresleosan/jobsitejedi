import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { collection, doc, getDoc } from "firebase/firestore";
import { signInWithEmailAndPassword } from "firebase/auth";
import { createHash, randomBytes } from "node:crypto";
import {
  assertAuthEmulatorOnly,
  assertFirestoreEmulatorOnly,
  provisionEmulatorUser,
} from "../../scripts/lib/firebase-auth-emulator.mjs";

const credentials = (label: string) => ({
  email: `functions-${label}-${Date.now()}@example.test`,
  password: "Valid-password-123!",
  fullName: `Functions ${label}`,
});

type AppRole = "admin" | "manager" | "builder";

interface AuthorizationGrantRecord {
  active: boolean;
  role: AppRole;
  grantId: string;
  updatedAt: unknown;
}

let registerWithInvitation: typeof import("@/lib/firebase/auth").registerWithInvitation;
let signIn: typeof import("@/lib/firebase/auth").signIn;
let signOut: typeof import("@/lib/firebase/auth").signOut;
let invitationOperations: typeof import("@/lib/firebase/functions").invitationOperations;
let submitInvoiceRecord: typeof import("@/lib/firebase/functions").submitInvoiceRecord;
let reviewInvoiceRecord: typeof import("@/lib/firebase/functions").reviewInvoiceRecord;
let extractJobsFromExcelRecord: typeof import("@/lib/firebase/functions").extractJobsFromExcelRecord;
let createProject: typeof import("@/lib/firebase/repositories/projects").createProject;
let uploadPrivateFile: typeof import("@/lib/firebase/storage").uploadPrivateFile;
let buildPrivateStoragePath: typeof import("@/lib/firebase/storage").buildPrivateStoragePath;
let firebaseDb: typeof import("@/lib/firebase/client").firebaseDb;
let firebaseAuth: typeof import("@/lib/firebase/client").firebaseAuth;
let clearPublicInvitationRateLimits: () => Promise<void>;
let callConsumeInvitationRaw: (payload: unknown) => Promise<unknown>;
let callValidateInvitationRaw: (payload: unknown) => Promise<unknown>;
let readEmulatorRole: (uid: string) => Promise<unknown>;
let readEmulatorClaims: (uid: string) => Promise<Record<string, unknown>>;
let readAuthorizationGrant: (uid: string) => Promise<AuthorizationGrantRecord | null>;
let isFirestoreTimestamp: (value: unknown) => boolean;
let writeAuthorizationGrantDocument: (
  uid: string,
  grant: Omit<AuthorizationGrantRecord, "updatedAt">,
) => Promise<void>;
let setPartialAuthorizationClaims: (
  uid: string,
  role: AppRole,
  grantId: string,
) => Promise<void>;
let rotateAuthorizationGrant: (uid: string, role: AppRole) => Promise<string>;
let setEmulatorRole: (uid: string, role: "admin" | "manager" | "builder" | null) => Promise<void>;
let setEmulatorEmailVerified: (uid: string, emailVerified: boolean) => Promise<void>;
let revokeEmulatorSessions: (uid: string) => Promise<void>;
let readEmulatorTokensValidAfter: (uid: string) => Promise<number>;
let countInvitationsCreatedBy: (uid: string) => Promise<number>;
let countInvitationsByCode: (code: string) => Promise<number>;
let readEmulatorIdentityByEmail: (email: string) => Promise<{
  uid: string;
  emailVerified: boolean;
  claims: Record<string, unknown>;
}>;
let prepareInvitationTarget: (
  input: ReturnType<typeof credentials>,
  emailVerified?: boolean,
) => Promise<{
  uid: string;
  enrollmentId: string;
  emailVerified: boolean;
}>;
let signInInvitationTarget: (
  input: ReturnType<typeof credentials>,
  emailVerified?: boolean,
) => Promise<{
  uid: string;
  enrollmentId: string;
  emailVerified: boolean;
}>;
let stagePendingInvitationAssignment: (
  code: string,
  uid: string,
  usedAtMs?: number,
) => Promise<void>;

interface InvitationRecord {
  id: string;
  schemaVersion?: unknown;
  targetEmailHash?: unknown;
  targetLockId?: unknown;
  targetUid?: unknown;
  targetEnrollmentHash?: unknown;
  requestKeyHash?: unknown;
  generation?: unknown;
  status?: unknown;
  claimAssignmentState?: unknown;
  usedBy?: unknown;
  usedAt?: unknown;
  claimAssignedAt?: unknown;
}

let readInvitationByCode: (code: string) => Promise<InvitationRecord | null>;
let readInvitationTargetByCode: (code: string) => Promise<Record<string, unknown> | null>;
let setInvitationSchemaVersion: (code: string, schemaVersion: number) => Promise<void>;
let seedLegacyInvitation: (input: {
  code: string;
  role: "admin" | "manager" | "builder";
  schemaVersion: 1 | 2;
  targetEmail?: string;
}) => Promise<string>;

const hashInvitationCode = (code: string) =>
  createHash("sha256").update(code.trim().toUpperCase()).digest("hex");

const uniqueInvitationCode = () => randomBytes(6).toString("hex").toUpperCase();

const signInRolelessUser = async (
  input: ReturnType<typeof credentials>,
  emailVerified = true,
) => {
  const user = await provisionEmulatorUser({
    email: input.email,
    password: input.password,
    displayName: input.fullName,
    role: null,
    emailVerified,
  });
  const credential = await signInWithEmailAndPassword(firebaseAuth, input.email, input.password);
  expect((await credential.user.getIdTokenResult()).claims.role).toBeUndefined();
  return user;
};

describe("Firebase invitation Functions", () => {
  beforeAll(async () => {
    vi.stubEnv("VITE_FIREBASE_USE_EMULATORS", "true");
    assertAuthEmulatorOnly();
    assertFirestoreEmulatorOnly();
    const [{ getApps, initializeApp }, { getAuth }, { getFirestore, Timestamp }, { httpsCallable }] = await Promise.all([
      import("../../functions/node_modules/firebase-admin/lib/app/index.js"),
      import("../../functions/node_modules/firebase-admin/lib/auth/index.js"),
      import("../../functions/node_modules/firebase-admin/lib/firestore/index.js"),
      import("firebase/functions"),
    ]);
    const adminApp = getApps().find((app) => app.name === "firebase-invitation-tests")
      ?? initializeApp({ projectId: "demo-jobsite-jedi" }, "firebase-invitation-tests");
    const adminAuth = getAuth(adminApp);
    const adminDb = getFirestore(adminApp);
    isFirestoreTimestamp = (value) => value instanceof Timestamp;
    writeAuthorizationGrantDocument = async (uid, grant) => {
      await adminDb.collection("authorizationGrants").doc(uid).set({
        ...grant,
        updatedAt: Timestamp.now(),
      });
    };
    setPartialAuthorizationClaims = async (uid, role, grantId) => {
      await adminAuth.setCustomUserClaims(uid, { role, authorizationGrantId: grantId });
    };
    rotateAuthorizationGrant = async (uid, role) => {
      const grantId = randomBytes(16).toString("hex");
      const user = await adminAuth.getUser(uid);
      await adminAuth.setCustomUserClaims(uid, {
        ...(user.customClaims ?? {}),
        role,
        authorizationGrantId: grantId,
      });
      await writeAuthorizationGrantDocument(uid, { active: true, role, grantId });
      return grantId;
    };
    readAuthorizationGrant = async (uid) => {
      const snapshot = await adminDb.collection("authorizationGrants").doc(uid).get();
      return snapshot.exists ? snapshot.data() as AuthorizationGrantRecord : null;
    };
    clearPublicInvitationRateLimits = async () => {
      const references = await adminDb.collection("functionRateLimits").listDocuments();
      await Promise.all(references.map((reference) => reference.delete()));
    };
    readEmulatorRole = async (uid) => (await adminAuth.getUser(uid)).customClaims?.role;
    readEmulatorClaims = async (uid) => ({ ...((await adminAuth.getUser(uid)).customClaims ?? {}) });
    readEmulatorIdentityByEmail = async (email) => {
      const user = await adminAuth.getUserByEmail(email.trim().toLowerCase());
      return {
        uid: user.uid,
        emailVerified: user.emailVerified,
        claims: { ...(user.customClaims ?? {}) },
      };
    };
    prepareInvitationTarget = async (input, emailVerified = true) => {
      const placeholder = await adminAuth.getUserByEmail(input.email.trim().toLowerCase());
      const enrollmentId = placeholder.customClaims?.invitationEnrollmentId;
      if (typeof enrollmentId !== "string" || !/^[a-f0-9]{32}$/.test(enrollmentId)) {
        throw new Error("Expected an invitation-created enrollment marker");
      }
      if (placeholder.customClaims?.role !== undefined) {
        throw new Error("Invitation placeholder must not have an application role");
      }

      await adminAuth.updateUser(placeholder.uid, {
        password: input.password,
        displayName: input.fullName,
        emailVerified,
      });
      const prepared = await adminAuth.getUser(placeholder.uid);
      if (prepared.customClaims?.invitationEnrollmentId !== enrollmentId) {
        throw new Error("Preparing the invitation account removed its enrollment marker");
      }
      if (prepared.customClaims?.role !== undefined) {
        throw new Error("Preparing the invitation account assigned an unexpected role");
      }
      if (prepared.emailVerified !== emailVerified) {
        throw new Error("Preparing the invitation account did not preserve verification state");
      }
      return { uid: prepared.uid, enrollmentId, emailVerified: prepared.emailVerified };
    };
    signInInvitationTarget = async (input, emailVerified = true) => {
      const prepared = await prepareInvitationTarget(input, emailVerified);
      const credential = await signInWithEmailAndPassword(firebaseAuth, input.email, input.password);
      const claims = (await credential.user.getIdTokenResult(true)).claims;
      expect(claims.role).toBeUndefined();
      expect(claims.invitationEnrollmentId).toBe(prepared.enrollmentId);
      return prepared;
    };
    setEmulatorRole = async (uid, role) => {
      const current = await adminAuth.getUser(uid);
      const currentClaims = { ...(current.customClaims ?? {}) };
      const currentRole = currentClaims.role;
      const currentGrantId = currentClaims.authorizationGrantId;
      delete currentClaims.role;
      delete currentClaims.authorizationGrantId;

      if (role === null) {
        await adminAuth.setCustomUserClaims(uid, currentClaims);
        if (
          (currentRole === "admin" || currentRole === "manager" || currentRole === "builder")
          && typeof currentGrantId === "string"
          && /^[a-f0-9]{32}$/.test(currentGrantId)
        ) {
          await writeAuthorizationGrantDocument(uid, {
            active: false,
            role: currentRole,
            grantId: currentGrantId,
          });
        }
        return;
      }

      const grantId = typeof currentGrantId === "string" && /^[a-f0-9]{32}$/.test(currentGrantId)
        ? currentGrantId
        : randomBytes(16).toString("hex");
      await adminAuth.setCustomUserClaims(uid, {
        ...currentClaims,
        role,
        authorizationGrantId: grantId,
      });
      await writeAuthorizationGrantDocument(uid, { active: true, role, grantId });
    };
    setEmulatorEmailVerified = async (uid, emailVerified) => {
      const enrollmentId = (await adminAuth.getUser(uid)).customClaims?.invitationEnrollmentId;
      await adminAuth.updateUser(uid, { emailVerified });
      if ((await adminAuth.getUser(uid)).customClaims?.invitationEnrollmentId !== enrollmentId) {
        throw new Error("Updating email verification removed the enrollment marker");
      }
    };
    revokeEmulatorSessions = async (uid) => {
      await adminAuth.revokeRefreshTokens(uid);
    };
    readEmulatorTokensValidAfter = async (uid) =>
      Date.parse((await adminAuth.getUser(uid)).tokensValidAfterTime ?? "");
    countInvitationsCreatedBy = async (uid) => (
      await adminDb.collection("invitations").where("createdBy", "==", uid).get()
    ).size;
    countInvitationsByCode = async (code) => (
      await adminDb.collection("invitations").where("codeHash", "==", hashInvitationCode(code)).get()
    ).size;
    stagePendingInvitationAssignment = async (code, uid, usedAtMs = Date.now()) => {
      const snapshot = await adminDb
        .collection("invitations")
        .where("codeHash", "==", hashInvitationCode(code))
        .limit(1)
        .get();
      if (snapshot.empty) throw new Error("Invitation fixture was not found");
      const invitation = snapshot.docs[0];
      const targetLockId = invitation.data().targetLockId;
      if (typeof targetLockId !== "string") throw new Error("Invitation target lock is missing");
      const batch = adminDb.batch();
      batch.update(invitation.ref, {
        status: "used",
        claimAssignmentState: "pending",
        usedBy: uid,
        usedAt: Timestamp.fromMillis(usedAtMs),
        claimAssignedAt: null,
      });
      batch.update(adminDb.collection("invitationTargets").doc(targetLockId), {
        status: "assigning",
        updatedAt: Timestamp.now(),
      });
      await batch.commit();
    };
    readInvitationByCode = async (code) => {
      const snapshot = await adminDb
        .collection("invitations")
        .where("codeHash", "==", hashInvitationCode(code))
        .limit(1)
        .get();
      if (snapshot.empty) return null;
      const invitation = snapshot.docs[0];
      return { id: invitation.id, ...invitation.data() };
    };
    readInvitationTargetByCode = async (code) => {
      const invitation = await readInvitationByCode(code);
      if (!invitation || typeof invitation.targetLockId !== "string") return null;
      const target = await adminDb.collection("invitationTargets").doc(invitation.targetLockId).get();
      return target.exists ? { id: target.id, ...target.data() } : null;
    };
    setInvitationSchemaVersion = async (code, schemaVersion) => {
      const snapshot = await adminDb
        .collection("invitations")
        .where("codeHash", "==", hashInvitationCode(code))
        .limit(1)
        .get();
      if (snapshot.empty) throw new Error("Invitation fixture was not found");
      await snapshot.docs[0].ref.update({ schemaVersion });
    };
    seedLegacyInvitation = async ({ code, role, schemaVersion, targetEmail }) => {
      const reference = adminDb.collection("invitations").doc(`legacy-${randomBytes(8).toString("hex")}`);
      const targetEmailSalt = "c".repeat(32);
      await reference.set({
        ...(schemaVersion === 2 ? {
          schemaVersion: 2,
          targetEmailHash: createHash("sha256")
            .update(`${targetEmailSalt}:${targetEmail?.trim().toLowerCase() ?? ""}`)
            .digest("hex"),
          targetEmailSalt,
        } : {}),
        codeHash: hashInvitationCode(code),
        role,
        status: "pending",
        createdBy: "legacy-test-admin",
        createdByRole: "admin",
        createdAt: Timestamp.now(),
        expiresAt: Timestamp.fromMillis(Date.now() + 5 * 60 * 1000),
        usedBy: null,
        usedAt: null,
      });
      return reference.id;
    };
    ({ registerWithInvitation, signIn, signOut } = await import("@/lib/firebase/auth"));
    ({ invitationOperations, submitInvoiceRecord, reviewInvoiceRecord, extractJobsFromExcelRecord } =
      await import("@/lib/firebase/functions"));
    ({ createProject } = await import("@/lib/firebase/repositories/projects"));
    ({ uploadPrivateFile, buildPrivateStoragePath } = await import("@/lib/firebase/storage"));
    const firebaseClient = await import("@/lib/firebase/client");
    ({ firebaseDb, firebaseAuth } = firebaseClient);
    const rawConsumeInvitation = httpsCallable<unknown, unknown>(
      firebaseClient.firebaseFunctions,
      "consumeInvitation",
    );
    callConsumeInvitationRaw = async (payload) => (await rawConsumeInvitation(payload)).data;
    const rawValidateInvitation = httpsCallable<unknown, unknown>(
      firebaseClient.firebaseFunctions,
      "validateInvitationCode",
    );
    callValidateInvitationRaw = async (payload) => (await rawValidateInvitation(payload)).data;
  });

  afterAll(async () => {
    await signOut();
    vi.unstubAllEnvs();
  });

  test("creates, validates, consumes once and accepts an idempotent retry", async () => {
    const managerCredentials = credentials("manager");
    const builderCredentials = credentials("invited-builder");
    const manager = await provisionEmulatorUser({
      email: managerCredentials.email,
      password: managerCredentials.password,
      displayName: managerCredentials.fullName,
      role: "manager",
    });
    await signIn(managerCredentials.email, managerCredentials.password);

    const invitationsBefore = await countInvitationsCreatedBy(manager.uid);
    const requestKey = randomBytes(32).toString("hex");
    const invitation = await invitationOperations.createInvitation({
      role: "builder",
      targetEmail: builderCredentials.email,
      requestKey,
    });
    const retriedInvitation = await invitationOperations.createInvitation({
      role: "builder",
      targetEmail: builderCredentials.email,
      requestKey,
    });
    expect(retriedInvitation).toEqual(invitation);
    expect(invitation.code).toMatch(/^[A-F0-9]{12}$/);
    expect(invitation.role).toBe("builder");
    expect(await countInvitationsCreatedBy(manager.uid))
      .toBe(invitationsBefore + 1);
    expect(await countInvitationsByCode(invitation.code)).toBe(1);

    const placeholder = await readEmulatorIdentityByEmail(builderCredentials.email);
    const enrollmentId = placeholder.claims.invitationEnrollmentId;
    expect(placeholder.emailVerified).toBe(false);
    expect(placeholder.claims.role).toBeUndefined();
    expect(enrollmentId).toMatch(/^[a-f0-9]{32}$/);
    const validation = await invitationOperations.validateInvitationCode(
      invitation.code,
      builderCredentials.email,
    );
    expect(validation).toMatchObject({
      valid: true,
      role: "builder",
      expiresAt: expect.any(Date),
      errorMessage: null,
    });
    expect(Object.keys(validation).sort()).toEqual([
      "errorMessage",
      "expiresAt",
      "role",
      "valid",
    ]);
    const rawValidation = await callValidateInvitationRaw({
      code: invitation.code,
      targetEmail: builderCredentials.email,
    });
    expect(rawValidation).toEqual({
      valid: true,
      role: "builder",
      expiresAt: expect.any(String),
      errorMessage: null,
    });
    expect(Object.keys(rawValidation as Record<string, unknown>).sort()).toEqual([
      "errorMessage",
      "expiresAt",
      "role",
      "valid",
    ]);

    const pendingInvitation = await readInvitationByCode(invitation.code);
    expect(pendingInvitation).toMatchObject({
      schemaVersion: 4,
      targetUid: placeholder.uid,
      status: "pending",
      claimAssignmentState: "not_started",
      usedBy: null,
      usedAt: null,
    });
    expect(pendingInvitation?.targetEmailHash).toMatch(/^[a-f0-9]{64}$/);
    expect(pendingInvitation?.targetLockId).toMatch(/^[a-f0-9]{64}$/);
    expect(pendingInvitation?.targetEnrollmentHash).toBe(
      createHash("sha256")
        .update(`invitation-enrollment-v1:${String(enrollmentId)}`)
        .digest("hex"),
    );
    expect(pendingInvitation?.requestKeyHash).toMatch(/^[a-f0-9]{64}$/);
    expect(pendingInvitation?.requestKeyHash).not.toBe(requestKey);
    expect(pendingInvitation?.generation).toBe(1);
    expect(await readInvitationTargetByCode(invitation.code)).toMatchObject({
      id: pendingInvitation?.targetLockId,
      invitationId: pendingInvitation?.id,
      requestKeyHash: pendingInvitation?.requestKeyHash,
      generation: pendingInvitation?.generation,
      status: "pending",
    });

    await signOut();
    const registration = await registerWithInvitation({
      ...builderCredentials,
      invitationCode: invitation.code,
    });
    expect(registration.status).toBe("complete");
    const invitedBuilder = registration.user;
    expect(invitedBuilder.id).toBe(placeholder.uid);
    expect(invitedBuilder.role).toBe("builder");
    expect(firebaseAuth.currentUser?.uid).toBe(placeholder.uid);
    expect((await readEmulatorIdentityByEmail(builderCredentials.email)).emailVerified).toBe(true);
    expect(await readEmulatorRole(invitedBuilder.id)).toBe("builder");
    const assignedClaims = await readEmulatorClaims(invitedBuilder.id);
    expect(assignedClaims.invitationEnrollmentId).toBeUndefined();
    expect(assignedClaims.authorizationGrantId).toMatch(/^[a-f0-9]{32}$/);
    expect(await readInvitationByCode(invitation.code)).toMatchObject({
      status: "used",
      claimAssignmentState: "completed",
      usedBy: invitedBuilder.id,
    });

    await invitationOperations.consumeInvitation({ code: invitation.code });
    expect(await readEmulatorRole(invitedBuilder.id)).toBe("builder");
    expect(assignedClaims).toEqual({
      role: "builder",
      authorizationGrantId: expect.stringMatching(/^[a-f0-9]{32}$/),
    });
    const authorizationGrantId = String(assignedClaims.authorizationGrantId);
    const assignedGrant = await readAuthorizationGrant(invitedBuilder.id);
    expect(assignedGrant).toEqual({
      active: true,
      role: "builder",
      grantId: authorizationGrantId,
      updatedAt: expect.anything(),
    });
    expect(isFirestoreTimestamp(assignedGrant?.updatedAt)).toBe(true);
    expect(await readInvitationByCode(invitation.code)).toMatchObject({
      schemaVersion: 4,
      status: "used",
      claimAssignmentState: "completed",
      usedBy: invitedBuilder.id,
      usedAt: expect.anything(),
      claimAssignedAt: expect.anything(),
    });

    await expect(invitationOperations.consumeInvitation({ code: invitation.code }))
      .resolves.toBeUndefined();
    expect(await readEmulatorClaims(invitedBuilder.id)).toEqual(assignedClaims);
    expect(await readAuthorizationGrant(invitedBuilder.id)).toEqual(assignedGrant);
    expect(await countInvitationsByCode(invitation.code)).toBe(1);
  }, 20_000);

  test("rejects an invitationId-only payload and an incorrect code without burning the invitation", async () => {
    const managerCredentials = credentials("payload-manager");
    const targetCredentials = credentials("payload-target");
    const victimCredentials = credentials("payload-victim");
    await provisionEmulatorUser({
      email: managerCredentials.email,
      password: managerCredentials.password,
      displayName: managerCredentials.fullName,
      role: "manager",
    });
    await signIn(managerCredentials.email, managerCredentials.password);
    const invitation = await invitationOperations.createInvitation({
      role: "builder",
      targetEmail: targetCredentials.email,
    });
    const storedInvitation = await readInvitationByCode(invitation.code);
    expect(storedInvitation).not.toBeNull();
    const victim = await provisionEmulatorUser({
      email: victimCredentials.email,
      password: victimCredentials.password,
      displayName: victimCredentials.fullName,
      role: null,
    });

    await signOut();
    const target = await signInInvitationTarget(targetCredentials);
    await expect(callConsumeInvitationRaw({ invitationId: storedInvitation?.id }))
      .rejects.toMatchObject({ code: "functions/invalid-argument" });
    await expect(invitationOperations.consumeInvitation({ code: "ZZZZZZZZZZZZ" }))
      .rejects.toMatchObject({ code: "functions/failed-precondition" });

    expect(await readEmulatorRole(target.uid)).toBeUndefined();
    expect(await readInvitationByCode(invitation.code)).toMatchObject({
      status: "pending",
      usedBy: null,
      usedAt: null,
    });
    await expect(callConsumeInvitationRaw({
      code: invitation.code,
      userId: victim.uid,
    })).resolves.toEqual({ role: "builder" });
    expect(await readEmulatorRole(target.uid)).toBe("builder");
    expect((await readEmulatorClaims(target.uid)).invitationEnrollmentId).toBeUndefined();
    expect(await readEmulatorRole(victim.uid)).toBeUndefined();
  }, 20_000);

  test("keeps the invitation pending until the exact target account verifies its email", async () => {
    const managerCredentials = credentials("verification-manager");
    const targetCredentials = credentials("verification-target");
    await provisionEmulatorUser({
      email: managerCredentials.email,
      password: managerCredentials.password,
      displayName: managerCredentials.fullName,
      role: "manager",
    });
    await signIn(managerCredentials.email, managerCredentials.password);
    const invitation = await invitationOperations.createInvitation({
      role: "builder",
      targetEmail: targetCredentials.email,
    });

    await signOut();
    const target = await signInInvitationTarget(targetCredentials, false);
    expect(await readInvitationByCode(invitation.code)).toMatchObject({
      schemaVersion: 4,
      targetUid: target.uid,
      status: "pending",
      claimAssignmentState: "not_started",
    });
    await expect(invitationOperations.consumeInvitation({ code: invitation.code }))
      .rejects.toMatchObject({
        code: "functions/failed-precondition",
        details: { reason: "email-not-verified" },
      });
    expect(await readEmulatorRole(target.uid)).toBeUndefined();
    expect((await readEmulatorClaims(target.uid)).invitationEnrollmentId)
      .toBe(target.enrollmentId);
    expect(await readInvitationByCode(invitation.code)).toMatchObject({
      status: "pending",
      claimAssignmentState: "not_started",
      usedBy: null,
    });

    await setEmulatorEmailVerified(target.uid, true);
    expect((await readEmulatorClaims(target.uid)).invitationEnrollmentId)
      .toBe(target.enrollmentId);
    await expect(invitationOperations.consumeInvitation({ code: invitation.code }))
      .resolves.toBeUndefined();
    expect(await readEmulatorRole(target.uid)).toBe("builder");
    expect((await readEmulatorClaims(target.uid)).invitationEnrollmentId).toBeUndefined();
    expect(await readInvitationByCode(invitation.code)).toMatchObject({
      status: "used",
      claimAssignmentState: "completed",
      usedBy: target.uid,
    });
  }, 25_000);

  test("rejects pre-existing roleless accounts without an enrollment marker", async () => {
    for (const emailVerified of [true, false]) {
      await signOut();
      const suffix = emailVerified ? "verified" : "unverified";
      const managerCredentials = credentials(`preexisting-manager-${suffix}`);
      const targetCredentials = credentials(`preexisting-target-${suffix}`);
      const target = await provisionEmulatorUser({
        email: targetCredentials.email,
        password: targetCredentials.password,
        displayName: targetCredentials.fullName,
        role: null,
        emailVerified,
      });
      const manager = await provisionEmulatorUser({
        email: managerCredentials.email,
        password: managerCredentials.password,
        displayName: managerCredentials.fullName,
        role: "manager",
      });
      expect((await readEmulatorClaims(target.uid)).invitationEnrollmentId).toBeUndefined();
      await signIn(managerCredentials.email, managerCredentials.password);
      const invitationsBefore = await countInvitationsCreatedBy(manager.uid);

      await expect(invitationOperations.createInvitation({
        role: "builder",
        targetEmail: targetCredentials.email,
        requestKey: randomBytes(32).toString("hex"),
      })).rejects.toMatchObject({ code: "functions/failed-precondition" });

      expect(await countInvitationsCreatedBy(manager.uid)).toBe(invitationsBefore);
      expect(await readEmulatorIdentityByEmail(targetCredentials.email)).toMatchObject({
        uid: target.uid,
        emailVerified,
        claims: {},
      });
    }
  }, 25_000);

  test("rejects a correct code when the authenticated email is not the invitation target", async () => {
    const managerCredentials = credentials("email-manager");
    const targetCredentials = credentials("email-target");
    const attackerCredentials = credentials("email-mismatch");
    await provisionEmulatorUser({
      email: managerCredentials.email,
      password: managerCredentials.password,
      displayName: managerCredentials.fullName,
      role: "manager",
    });
    await signIn(managerCredentials.email, managerCredentials.password);
    const invitation = await invitationOperations.createInvitation({
      role: "builder",
      targetEmail: targetCredentials.email,
    });

    await signOut();
    const attacker = await signInRolelessUser(attackerCredentials);
    await expect(
      invitationOperations.validateInvitationCode(invitation.code, attackerCredentials.email),
    ).resolves.toMatchObject({ valid: false, role: null, expiresAt: null });
    await expect(invitationOperations.consumeInvitation({ code: invitation.code }))
      .rejects.toMatchObject({ code: "functions/failed-precondition" });
    expect(await readEmulatorRole(attacker.uid)).toBeUndefined();
    expect(await readInvitationByCode(invitation.code)).toMatchObject({
      status: "pending",
      usedBy: null,
      usedAt: null,
    });

    await signOut();
    const target = await signInInvitationTarget(targetCredentials);
    await expect(invitationOperations.consumeInvitation({ code: invitation.code }))
      .resolves.toBeUndefined();
    expect(await readEmulatorRole(target.uid)).toBe("builder");
    expect((await readEmulatorClaims(target.uid)).invitationEnrollmentId).toBeUndefined();
    expect(await readInvitationByCode(invitation.code)).toMatchObject({
      status: "used",
      usedBy: target.uid,
    });
  }, 20_000);

  test("rejects a legacy v1 invitation during validation and consumption", async () => {
    const code = uniqueInvitationCode();
    const targetCredentials = credentials("legacy-target");
    const legacyId = await seedLegacyInvitation({ code, role: "admin", schemaVersion: 1 });

    await signOut();
    const validation = await invitationOperations.validateInvitationCode(code);
    expect(validation).toMatchObject({ valid: false });
    expect(validation).not.toHaveProperty("invitationId");

    const target = await signInRolelessUser(targetCredentials);
    await expect(invitationOperations.consumeInvitation({ code }))
      .rejects.toMatchObject({ code: "functions/failed-precondition" });
    expect(await readEmulatorRole(target.uid)).toBeUndefined();
    expect(await readInvitationByCode(code)).toMatchObject({
      id: legacyId,
      status: "pending",
      usedBy: null,
      usedAt: null,
    });
  }, 20_000);

  test("rejects a complete v2 invitation contract after the v4 security upgrade", async () => {
    const code = uniqueInvitationCode();
    const targetCredentials = credentials("legacy-v2-target");
    const legacyId = await seedLegacyInvitation({
      code,
      role: "admin",
      schemaVersion: 2,
      targetEmail: targetCredentials.email,
    });

    await signOut();
    await expect(
      invitationOperations.validateInvitationCode(code, targetCredentials.email),
    ).resolves.toMatchObject({ valid: false, role: null, expiresAt: null });
    const target = await signInRolelessUser(targetCredentials);
    await expect(invitationOperations.consumeInvitation({ code }))
      .rejects.toMatchObject({ code: "functions/failed-precondition" });
    expect(await readEmulatorRole(target.uid)).toBeUndefined();
    expect(await readInvitationByCode(code)).toMatchObject({
      id: legacyId,
      schemaVersion: 2,
      status: "pending",
      usedBy: null,
      usedAt: null,
    });
  }, 20_000);

  test("fails closed when an otherwise current invitation is downgraded to schema v3", async () => {
    const managerCredentials = credentials("legacy-v3-manager");
    const targetCredentials = credentials("legacy-v3-target");
    await provisionEmulatorUser({
      email: managerCredentials.email,
      password: managerCredentials.password,
      displayName: managerCredentials.fullName,
      role: "manager",
    });
    await signIn(managerCredentials.email, managerCredentials.password);
    const invitation = await invitationOperations.createInvitation({
      role: "builder",
      targetEmail: targetCredentials.email,
      requestKey: randomBytes(32).toString("hex"),
    });
    await setInvitationSchemaVersion(invitation.code, 3);

    await expect(
      invitationOperations.validateInvitationCode(invitation.code, targetCredentials.email),
    ).resolves.toMatchObject({ valid: false, role: null, expiresAt: null });
    await signOut();
    const target = await signInInvitationTarget(targetCredentials);
    await expect(invitationOperations.consumeInvitation({ code: invitation.code }))
      .rejects.toMatchObject({ code: "functions/failed-precondition" });
    expect(await readEmulatorClaims(target.uid)).toMatchObject({
      invitationEnrollmentId: target.enrollmentId,
    });
    expect(await readEmulatorRole(target.uid)).toBeUndefined();
    expect(await readInvitationByCode(invitation.code)).toMatchObject({
      schemaVersion: 3,
      status: "pending",
      claimAssignmentState: "not_started",
      usedBy: null,
    });
  }, 20_000);

  test("rejects stale admin tokens after the Auth claim is downgraded to manager", async () => {
    const issuerCredentials = credentials("stale-token-issuer");
    const actorCredentials = credentials("stale-token-actor");
    const forgedTargetCredentials = credentials("stale-token-forged-target");
    await provisionEmulatorUser({
      email: issuerCredentials.email,
      password: issuerCredentials.password,
      displayName: issuerCredentials.fullName,
      role: "admin",
    });
    await signIn(issuerCredentials.email, issuerCredentials.password);
    const targetInvitation = await invitationOperations.createInvitation({
      role: "builder",
      targetEmail: actorCredentials.email,
    });

    await signOut();
    const actor = await provisionEmulatorUser({
      email: actorCredentials.email,
      password: actorCredentials.password,
      displayName: actorCredentials.fullName,
      role: "admin",
    });
    await signIn(actorCredentials.email, actorCredentials.password);
    const staleTokenUser = firebaseAuth.currentUser;
    if (!staleTokenUser) throw new Error("Expected the stale-token actor to stay authenticated");
    expect((await staleTokenUser.getIdTokenResult()).claims.role).toBe("admin");

    await setEmulatorRole(actor.uid, "manager");
    expect(await readEmulatorRole(actor.uid)).toBe("manager");
    expect((await staleTokenUser.getIdTokenResult(false)).claims.role).toBe("admin");
    expect(await countInvitationsCreatedBy(actor.uid)).toBe(0);

    await expect(invitationOperations.createInvitation({
      role: "builder",
      targetEmail: forgedTargetCredentials.email,
    })).rejects.toMatchObject({ code: "functions/permission-denied" });
    await expect(invitationOperations.consumeInvitation({ code: targetInvitation.code }))
      .rejects.toMatchObject({ code: "functions/permission-denied" });

    expect(await countInvitationsCreatedBy(actor.uid)).toBe(0);
    expect(await readEmulatorRole(actor.uid)).toBe("manager");
    expect(await readInvitationByCode(targetInvitation.code)).toMatchObject({
      status: "pending",
      usedBy: null,
      usedAt: null,
    });
  }, 25_000);

  test.each(["rotated", "inactive"] as const)(
    "rejects a cached privileged token when its authorization grant document is %s",
    async (grantState) => {
      const actorCredentials = credentials(`grant-${grantState}-manager`);
      const preflightTargetCredentials = credentials(`grant-${grantState}-preflight-target`);
      const blockedTargetCredentials = credentials(`grant-${grantState}-blocked-target`);
      const actor = await provisionEmulatorUser({
        email: actorCredentials.email,
        password: actorCredentials.password,
        displayName: actorCredentials.fullName,
        role: "manager",
      });
      await signIn(actorCredentials.email, actorCredentials.password);
      const staleUser = firebaseAuth.currentUser;
      if (!staleUser) throw new Error("Expected a cached manager ID token");

      const tokenBeforeGrantChange = await staleUser.getIdToken(false);
      const tokenResultBeforeGrantChange = await staleUser.getIdTokenResult(false);
      const originalGrantId = tokenResultBeforeGrantChange.claims.authorizationGrantId;
      expect(tokenResultBeforeGrantChange.claims.role).toBe("manager");
      expect(originalGrantId).toMatch(/^[a-f0-9]{32}$/);
      expect(await readEmulatorClaims(actor.uid)).toEqual({
        role: "manager",
        authorizationGrantId: originalGrantId,
      });
      const originalGrant = await readAuthorizationGrant(actor.uid);
      expect(originalGrant).toEqual({
        active: true,
        role: "manager",
        grantId: originalGrantId,
        updatedAt: expect.anything(),
      });
      expect(isFirestoreTimestamp(originalGrant?.updatedAt)).toBe(true);

      await expect(invitationOperations.createInvitation({
        role: "builder",
        targetEmail: preflightTargetCredentials.email,
      })).resolves.toMatchObject({ role: "builder" });
      const invitationsBeforeBlockedCall = await countInvitationsCreatedBy(actor.uid);

      const rotatedGrantId = originalGrantId === "f".repeat(32)
        ? "e".repeat(32)
        : "f".repeat(32);
      await writeAuthorizationGrantDocument(actor.uid, {
        active: grantState !== "inactive",
        role: "manager",
        grantId: grantState === "rotated" ? rotatedGrantId : String(originalGrantId),
      });

      const changedGrant = await readAuthorizationGrant(actor.uid);
      expect(changedGrant).toEqual({
        active: grantState !== "inactive",
        role: "manager",
        grantId: grantState === "rotated" ? rotatedGrantId : originalGrantId,
        updatedAt: expect.anything(),
      });
      expect(isFirestoreTimestamp(changedGrant?.updatedAt)).toBe(true);
      expect(await readEmulatorClaims(actor.uid)).toEqual({
        role: "manager",
        authorizationGrantId: originalGrantId,
      });
      expect(await staleUser.getIdToken(false)).toBe(tokenBeforeGrantChange);
      expect((await staleUser.getIdTokenResult(false)).claims.authorizationGrantId)
        .toBe(originalGrantId);

      await expect(invitationOperations.createInvitation({
        role: "builder",
        targetEmail: blockedTargetCredentials.email,
      })).rejects.toMatchObject({ code: "functions/permission-denied" });
      expect(await countInvitationsCreatedBy(actor.uid)).toBe(invitationsBeforeBlockedCall);
      expect(await readEmulatorClaims(actor.uid)).toEqual({
        role: "manager",
        authorizationGrantId: originalGrantId,
      });
      await signOut();
    },
    30_000,
  );

  test("rejects an old token after a full grant rotation and accepts the refreshed token", async () => {
    const actorCredentials = credentials("full-grant-rotation-manager");
    const preflightTargetCredentials = credentials("full-grant-rotation-preflight-target");
    const staleTargetCredentials = credentials("full-grant-rotation-stale-target");
    const refreshedTargetCredentials = credentials("full-grant-rotation-refreshed-target");
    const actor = await provisionEmulatorUser({
      email: actorCredentials.email,
      password: actorCredentials.password,
      displayName: actorCredentials.fullName,
      role: "manager",
    });
    await signIn(actorCredentials.email, actorCredentials.password);
    const currentUser = firebaseAuth.currentUser;
    if (!currentUser) throw new Error("Expected a manager session before rotating its grant");

    const oldToken = await currentUser.getIdToken(false);
    const oldTokenResult = await currentUser.getIdTokenResult(false);
    const oldGrantId = oldTokenResult.claims.authorizationGrantId;
    if (typeof oldGrantId !== "string" || !/^[a-f0-9]{32}$/.test(oldGrantId)) {
      throw new Error("Expected the cached token to contain a valid authorization grant id");
    }
    expect(oldTokenResult.claims.role).toBe("manager");
    await expect(invitationOperations.createInvitation({
      role: "builder",
      targetEmail: preflightTargetCredentials.email,
    })).resolves.toMatchObject({ role: "builder" });
    const invitationsAfterPreflight = await countInvitationsCreatedBy(actor.uid);

    const newGrantId = await rotateAuthorizationGrant(actor.uid, "manager");
    expect(newGrantId).toMatch(/^[a-f0-9]{32}$/);
    expect(newGrantId).not.toBe(oldGrantId);
    expect(await readEmulatorClaims(actor.uid)).toEqual({
      role: "manager",
      authorizationGrantId: newGrantId,
    });
    const rotatedGrant = await readAuthorizationGrant(actor.uid);
    expect(rotatedGrant).toEqual({
      active: true,
      role: "manager",
      grantId: newGrantId,
      updatedAt: expect.anything(),
    });
    expect(isFirestoreTimestamp(rotatedGrant?.updatedAt)).toBe(true);
    expect(await currentUser.getIdToken(false)).toBe(oldToken);
    expect((await currentUser.getIdTokenResult(false)).claims.authorizationGrantId)
      .toBe(oldGrantId);

    await expect(invitationOperations.createInvitation({
      role: "builder",
      targetEmail: staleTargetCredentials.email,
    })).rejects.toMatchObject({ code: "functions/permission-denied" });
    expect(await countInvitationsCreatedBy(actor.uid)).toBe(invitationsAfterPreflight);
    expect(await currentUser.getIdToken(false)).toBe(oldToken);

    const refreshedToken = await currentUser.getIdToken(true);
    const refreshedTokenResult = await currentUser.getIdTokenResult(false);
    expect(refreshedToken).not.toBe(oldToken);
    expect(refreshedTokenResult.claims.role).toBe("manager");
    expect(refreshedTokenResult.claims.authorizationGrantId).toBe(newGrantId);
    await expect(invitationOperations.createInvitation({
      role: "builder",
      targetEmail: refreshedTargetCredentials.email,
    })).resolves.toMatchObject({ role: "builder" });
    expect(await countInvitationsCreatedBy(actor.uid)).toBe(invitationsAfterPreflight + 1);
  }, 30_000);

  test("rejects a privileged ID token after its sessions are revoked without changing the role", async () => {
    const adminCredentials = credentials("revoked-session-admin");
    const preflightTargetCredentials = credentials("revoked-session-preflight-target");
    const targetCredentials = credentials("revoked-session-target");
    const admin = await provisionEmulatorUser({
      email: adminCredentials.email,
      password: adminCredentials.password,
      displayName: adminCredentials.fullName,
      role: "admin",
    });
    await signIn(adminCredentials.email, adminCredentials.password);
    const staleUser = firebaseAuth.currentUser;
    if (!staleUser) throw new Error("Expected a cached admin ID token");
    const tokenBeforeRevocation = await staleUser.getIdToken(false);
    const tokenResultBeforeRevocation = await staleUser.getIdTokenResult(false);
    expect(tokenResultBeforeRevocation.claims.role).toBe("admin");
    await expect(invitationOperations.createInvitation({
      role: "builder",
      targetEmail: preflightTargetCredentials.email,
    })).resolves.toMatchObject({ role: "builder" });
    const invitationsBefore = await countInvitationsCreatedBy(admin.uid);

    await new Promise((resolve) => setTimeout(resolve, 1_100));
    await revokeEmulatorSessions(admin.uid);
    const validAfterMs = await readEmulatorTokensValidAfter(admin.uid);
    const authTimeSeconds = Number(tokenResultBeforeRevocation.claims.auth_time);
    expect(validAfterMs).toBeGreaterThan(authTimeSeconds * 1_000);
    expect(await readEmulatorRole(admin.uid)).toBe("admin");
    expect(await staleUser.getIdToken(false)).toBe(tokenBeforeRevocation);
    expect((await staleUser.getIdTokenResult(false)).claims.auth_time).toBe(authTimeSeconds);
    expect((await staleUser.getIdTokenResult(false)).claims.role).toBe("admin");

    await expect(invitationOperations.createInvitation({
      role: "builder",
      targetEmail: targetCredentials.email,
    })).rejects.toMatchObject({ code: "functions/permission-denied" });
    expect(await countInvitationsCreatedBy(admin.uid)).toBe(invitationsBefore);
  }, 20_000);

  test("does not consume an invitation with a revoked target session", async () => {
    const managerCredentials = credentials("revoked-consume-manager");
    const targetCredentials = credentials("revoked-consume-target");
    await provisionEmulatorUser({
      email: managerCredentials.email,
      password: managerCredentials.password,
      displayName: managerCredentials.fullName,
      role: "manager",
    });
    await signIn(managerCredentials.email, managerCredentials.password);
    const invitation = await invitationOperations.createInvitation({
      role: "builder",
      targetEmail: targetCredentials.email,
    });

    await signOut();
    const target = await signInInvitationTarget(targetCredentials);
    const staleTarget = firebaseAuth.currentUser;
    if (!staleTarget) throw new Error("Expected a cached target ID token");
    const tokenBeforeRevocation = await staleTarget.getIdToken(false);
    await new Promise((resolve) => setTimeout(resolve, 1_100));
    await revokeEmulatorSessions(target.uid);
    expect(await staleTarget.getIdToken(false)).toBe(tokenBeforeRevocation);

    await expect(invitationOperations.consumeInvitation({ code: invitation.code }))
      .rejects.toMatchObject({ code: "functions/permission-denied" });
    expect(await readEmulatorRole(target.uid)).toBeUndefined();
    expect((await readEmulatorClaims(target.uid)).invitationEnrollmentId)
      .toBe(target.enrollmentId);
    expect(await readInvitationByCode(invitation.code)).toMatchObject({
      status: "pending",
      claimAssignmentState: "not_started",
      usedBy: null,
    });
  }, 20_000);

  test("converges concurrent retries from the same target to one completed assignment", async () => {
    const managerCredentials = credentials("race-manager");
    const targetCredentials = credentials("race-target");
    await provisionEmulatorUser({
      email: managerCredentials.email,
      password: managerCredentials.password,
      displayName: managerCredentials.fullName,
      role: "manager",
    });
    await signIn(managerCredentials.email, managerCredentials.password);
    const invitation = await invitationOperations.createInvitation({
      role: "builder",
      targetEmail: targetCredentials.email,
    });

    await signOut();
    const target = await signInInvitationTarget(targetCredentials);
    const results = await Promise.allSettled([
      invitationOperations.consumeInvitation({ code: invitation.code }),
      invitationOperations.consumeInvitation({ code: invitation.code }),
    ]);
    const fulfilled = results.filter((result) => result.status === "fulfilled");
    expect(fulfilled).toHaveLength(2);
    expect(await countInvitationsByCode(invitation.code)).toBe(1);
    expect(await readEmulatorRole(target.uid)).toBe("builder");
    expect((await readEmulatorClaims(target.uid)).invitationEnrollmentId).toBeUndefined();
    expect(await readInvitationByCode(invitation.code)).toMatchObject({
      schemaVersion: 4,
      status: "used",
      claimAssignmentState: "completed",
      usedBy: target.uid,
      usedAt: expect.anything(),
    });
  }, 25_000);

  test("allows only one active invitation and one role assignment for the same target email", async () => {
    const adminCredentials = credentials("target-lock-admin");
    const targetCredentials = credentials("target-lock-user");
    const admin = await provisionEmulatorUser({
      email: adminCredentials.email,
      password: adminCredentials.password,
      displayName: adminCredentials.fullName,
      role: "admin",
    });
    await signIn(adminCredentials.email, adminCredentials.password);
    const invitationsBefore = await countInvitationsCreatedBy(admin.uid);
    const winner = await invitationOperations.createInvitation({
      role: "builder",
      targetEmail: targetCredentials.email,
      requestKey: randomBytes(32).toString("hex"),
    });
    await expect(invitationOperations.createInvitation({
      role: "manager",
      targetEmail: targetCredentials.email.toUpperCase(),
      requestKey: randomBytes(32).toString("hex"),
    })).rejects.toMatchObject({ code: "functions/already-exists" });
    expect(await countInvitationsCreatedBy(admin.uid)).toBe(invitationsBefore + 1);

    const winningInvitation = await readInvitationByCode(winner.code);
    expect(winningInvitation).toMatchObject({
      schemaVersion: 4,
      generation: 1,
      requestKeyHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(await readInvitationTargetByCode(winner.code)).toMatchObject({
      id: winningInvitation?.targetLockId,
      invitationId: winningInvitation?.id,
      requestKeyHash: winningInvitation?.requestKeyHash,
      generation: winningInvitation?.generation,
      status: "pending",
    });
    await signOut();
    const target = await signInInvitationTarget(targetCredentials);
    await expect(invitationOperations.consumeInvitation({ code: winner.code }))
      .resolves.toBeUndefined();
    expect(await readEmulatorRole(target.uid)).toBe(winner.role);
    expect((await readEmulatorClaims(target.uid)).invitationEnrollmentId).toBeUndefined();
    expect(await readInvitationByCode(winner.code)).toMatchObject({
      status: "used",
      claimAssignmentState: "completed",
      usedBy: target.uid,
    });
    expect(await readInvitationTargetByCode(winner.code)).toMatchObject({
      invitationId: winningInvitation?.id,
      generation: winningInvitation?.generation,
      status: "completed",
    });
  }, 25_000);

  test("repairs a pending claim assignment but never restores a role after completion", async () => {
    const managerCredentials = credentials("assignment-recovery-manager");
    const targetCredentials = credentials("assignment-recovery-target");
    await provisionEmulatorUser({
      email: managerCredentials.email,
      password: managerCredentials.password,
      displayName: managerCredentials.fullName,
      role: "manager",
    });
    await signIn(managerCredentials.email, managerCredentials.password);
    const invitation = await invitationOperations.createInvitation({
      role: "builder",
      targetEmail: targetCredentials.email,
    });

    await signOut();
    const target = await signInInvitationTarget(targetCredentials);
    await stagePendingInvitationAssignment(invitation.code, target.uid);
    expect(await readInvitationByCode(invitation.code)).toMatchObject({
      status: "used",
      claimAssignmentState: "pending",
      usedBy: target.uid,
      usedAt: expect.anything(),
    });
    expect(await readInvitationTargetByCode(invitation.code)).toMatchObject({
      status: "assigning",
    });
    expect(await readEmulatorRole(target.uid)).toBeUndefined();
    await expect(invitationOperations.consumeInvitation({ code: invitation.code }))
      .resolves.toBeUndefined();
    expect(await readEmulatorRole(target.uid)).toBe("builder");
    expect((await readEmulatorClaims(target.uid)).invitationEnrollmentId).toBeUndefined();
    const completedInvitation = await readInvitationByCode(invitation.code);
    expect(completedInvitation).toMatchObject({
      status: "used",
      claimAssignmentState: "completed",
      usedBy: target.uid,
      claimAssignedAt: expect.anything(),
    });
    const completedTarget = await readInvitationTargetByCode(invitation.code);
    expect(completedTarget).toMatchObject({ status: "completed" });

    await setEmulatorRole(target.uid, null);
    expect(await readEmulatorRole(target.uid)).toBeUndefined();
    const refreshedTarget = firebaseAuth.currentUser;
    if (!refreshedTarget) throw new Error("Expected the target session to remain active");
    await refreshedTarget.getIdToken(true);
    expect((await refreshedTarget.getIdTokenResult(false)).claims.role).toBeUndefined();
    await expect(invitationOperations.consumeInvitation({ code: invitation.code }))
      .rejects.toMatchObject({ code: "functions/permission-denied" });
    expect(await readEmulatorRole(target.uid)).toBeUndefined();
    const invitationAfterRevocation = await readInvitationByCode(invitation.code);
    expect(invitationAfterRevocation).toMatchObject({
      status: "used",
      claimAssignmentState: "completed",
      usedBy: target.uid,
    });
    expect(invitationAfterRevocation?.usedAt).toEqual(completedInvitation?.usedAt);
    expect(invitationAfterRevocation?.claimAssignedAt).toEqual(completedInvitation?.claimAssignedAt);
    expect(await readInvitationTargetByCode(invitation.code)).toEqual(completedTarget);
  }, 25_000);

  test("does not reactivate an inactive authorization tombstone during pending assignment recovery", async () => {
    const managerCredentials = credentials("inactive-recovery-manager");
    const targetCredentials = credentials("inactive-recovery-target");
    await provisionEmulatorUser({
      email: managerCredentials.email,
      password: managerCredentials.password,
      displayName: managerCredentials.fullName,
      role: "manager",
    });
    await signIn(managerCredentials.email, managerCredentials.password);
    const invitation = await invitationOperations.createInvitation({
      role: "builder",
      targetEmail: targetCredentials.email,
    });

    await signOut();
    const target = await signInInvitationTarget(targetCredentials);
    const targetUser = firebaseAuth.currentUser;
    if (!targetUser || targetUser.uid !== target.uid) {
      throw new Error("Expected the invited target session to remain active");
    }
    await stagePendingInvitationAssignment(invitation.code, target.uid);

    const grantId = randomBytes(16).toString("hex");
    await setPartialAuthorizationClaims(target.uid, "builder", grantId);
    await writeAuthorizationGrantDocument(target.uid, {
      active: false,
      role: "builder",
      grantId,
    });
    const partialTokenClaims = (await targetUser.getIdTokenResult(true)).claims;
    expect(partialTokenClaims.role).toBe("builder");
    expect(partialTokenClaims.authorizationGrantId).toBe(grantId);
    expect(partialTokenClaims.invitationEnrollmentId).toBeUndefined();

    const partialAdminClaims = await readEmulatorClaims(target.uid);
    expect(partialAdminClaims).toEqual({
      role: "builder",
      authorizationGrantId: grantId,
    });
    const tombstoneBeforeRetry = await readAuthorizationGrant(target.uid);
    expect(tombstoneBeforeRetry).toEqual({
      active: false,
      role: "builder",
      grantId,
      updatedAt: expect.anything(),
    });
    expect(isFirestoreTimestamp(tombstoneBeforeRetry?.updatedAt)).toBe(true);

    const invitationBeforeRetry = await readInvitationByCode(invitation.code);
    const targetBeforeRetry = await readInvitationTargetByCode(invitation.code);
    expect(invitationBeforeRetry).toMatchObject({
      status: "used",
      claimAssignmentState: "pending",
      usedBy: target.uid,
      claimAssignedAt: null,
    });
    expect(targetBeforeRetry).toMatchObject({ status: "assigning" });

    await expect(invitationOperations.consumeInvitation({ code: invitation.code }))
      .rejects.toMatchObject({ code: "functions/internal" });

    expect(await readAuthorizationGrant(target.uid)).toEqual(tombstoneBeforeRetry);
    expect(await readEmulatorClaims(target.uid)).toEqual(partialAdminClaims);
    expect(await readInvitationByCode(invitation.code)).toEqual(invitationBeforeRetry);
    expect(await readInvitationTargetByCode(invitation.code)).toEqual(targetBeforeRetry);
  }, 25_000);

  test("fails closed after the bounded claim-assignment recovery window", async () => {
    const managerCredentials = credentials("expired-recovery-manager");
    const targetCredentials = credentials("expired-recovery-target");
    await provisionEmulatorUser({
      email: managerCredentials.email,
      password: managerCredentials.password,
      displayName: managerCredentials.fullName,
      role: "manager",
    });
    await signIn(managerCredentials.email, managerCredentials.password);
    const invitation = await invitationOperations.createInvitation({
      role: "builder",
      targetEmail: targetCredentials.email,
    });

    await signOut();
    const target = await signInInvitationTarget(targetCredentials);
    await stagePendingInvitationAssignment(
      invitation.code,
      target.uid,
      Date.now() - 3 * 60 * 1_000,
    );
    await expect(invitationOperations.consumeInvitation({ code: invitation.code }))
      .rejects.toMatchObject({ code: "functions/failed-precondition" });
    expect(await readEmulatorRole(target.uid)).toBeUndefined();
    expect((await readEmulatorClaims(target.uid)).invitationEnrollmentId)
      .toBe(target.enrollmentId);
    expect(await readInvitationByCode(invitation.code)).toMatchObject({
      status: "used",
      claimAssignmentState: "pending",
      usedBy: target.uid,
    });
    expect(await readInvitationTargetByCode(invitation.code)).toMatchObject({
      status: "assigning",
    });
  }, 20_000);

  test("reserves privileged invitations for admin and lets admin inherit manager operations", async () => {
    const builderCredentials = credentials("admin-target-builder");
    const invitedBuilderCredentials = credentials("manager-builder-invite-target");
    const builder = await provisionEmulatorUser({
      email: builderCredentials.email,
      password: builderCredentials.password,
      displayName: builderCredentials.fullName,
      role: "builder",
    });
    const managerCredentials = credentials("limited-manager");
    const manager = await provisionEmulatorUser({
      email: managerCredentials.email,
      password: managerCredentials.password,
      displayName: managerCredentials.fullName,
      role: "manager",
    });
    const adminCredentials = credentials("admin");
    const admin = await provisionEmulatorUser({
      email: adminCredentials.email,
      password: adminCredentials.password,
      displayName: adminCredentials.fullName,
      role: "admin",
    });
    for (const actor of [
      { uid: manager.uid, role: "manager" as const },
      { uid: admin.uid, role: "admin" as const },
    ]) {
      const claims = await readEmulatorClaims(actor.uid);
      expect(claims).toEqual({
        role: actor.role,
        authorizationGrantId: expect.stringMatching(/^[a-f0-9]{32}$/),
      });
      const grant = await readAuthorizationGrant(actor.uid);
      expect(grant).toEqual({
        active: true,
        role: actor.role,
        grantId: claims.authorizationGrantId,
        updatedAt: expect.anything(),
      });
      expect(isFirestoreTimestamp(grant?.updatedAt)).toBe(true);
    }

    await signIn(managerCredentials.email, managerCredentials.password);
    await expect(invitationOperations.createInvitation({
      role: "manager",
      targetEmail: credentials("manager-invite-target").email,
    }))
      .rejects.toMatchObject({ code: "functions/permission-denied" });
    await expect(invitationOperations.createInvitation({
      role: "admin",
      targetEmail: credentials("admin-invite-target").email,
    }))
      .rejects.toMatchObject({ code: "functions/permission-denied" });
    await expect(invitationOperations.createInvitation({
      role: "builder",
      targetEmail: invitedBuilderCredentials.email,
    }))
      .resolves.toBeDefined();

    await signOut();
    await signIn(adminCredentials.email, adminCredentials.password);
    await expect(invitationOperations.createInvitation({
      role: "admin",
      targetEmail: adminCredentials.email,
      requestKey: randomBytes(32).toString("hex"),
    })).rejects.toMatchObject({ code: "functions/permission-denied" });
    const managerInvitation = await invitationOperations.createInvitation({
      role: "manager",
      targetEmail: credentials("new-manager").email,
    });
    const builderInvitation = await invitationOperations.createInvitation({
      role: "builder",
      targetEmail: credentials("new-builder").email,
    });
    await expect(invitationOperations.validateInvitationCode(managerInvitation.code))
      .resolves.toMatchObject({
        valid: true,
        role: "manager",
        expiresAt: expect.any(Date),
        errorMessage: null,
      });
    await expect(invitationOperations.validateInvitationCode(builderInvitation.code))
      .resolves.toMatchObject({
        valid: true,
        role: "builder",
        expiresAt: expect.any(Date),
        errorMessage: null,
      });

    await expect(createProject({
      builderId: builder.uid,
      name: "Admin assigned project",
      clientName: "Admin client",
    })).resolves.toMatchObject({ builderId: builder.uid, createdBy: expect.any(String) });
  }, 25_000);

  test("submits an invoice idempotently and restricts review to managers", async () => {
    const builderCredentials = credentials("invoice-builder");
    const builder = await provisionEmulatorUser({
      email: builderCredentials.email,
      password: builderCredentials.password,
      displayName: builderCredentials.fullName,
      role: "builder",
    });
    const managerCredentials = credentials("invoice-manager");
    await provisionEmulatorUser({
      email: managerCredentials.email,
      password: managerCredentials.password,
      displayName: managerCredentials.fullName,
      role: "manager",
    });
    await signIn(managerCredentials.email, managerCredentials.password);
    const project = await createProject({
      builderId: builder.uid,
      name: "Functions invoice project",
      clientName: "Invoice client",
    });
    await signOut();
    await signIn(builderCredentials.email, builderCredentials.password);
    const invoiceId = doc(collection(firebaseDb, "invoices")).id;
    const quarantinePath = buildPrivateStoragePath(
      "invoice-quarantine",
      builder.uid,
      invoiceId,
      "upload",
    );
    await uploadPrivateFile(
      quarantinePath,
      new Blob([Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
        "base64",
      )], { type: "image/png" }),
      { contentType: "image/png" },
    );
    const payload = {
      invoiceId,
      projectId: project.id,
      invoiceNumber: "INV-FN-100",
      supplierName: "Functions Supplier",
      invoiceDate: "2026-08-24",
      totalAmountMinor: 45_678,
      currency: "GBP" as const,
      notes: "Callable integration fixture",
      quarantinePath,
      originalFileName: "invoice.png",
    };

    await expect(submitInvoiceRecord(payload)).resolves.toEqual({ invoiceId, status: "submitted" });
    await expect(submitInvoiceRecord(payload)).resolves.toEqual({ invoiceId, status: "submitted" });
    const storedInvoice = await getDoc(doc(firebaseDb, "invoices", invoiceId));
    expect(storedInvoice.data()).toMatchObject({
      fileName: "invoice.png",
      contentType: "image/png",
      filePath: `invoices/${builder.uid}/${invoiceId}/invoice.png`,
    });
    await expect(submitInvoiceRecord({ ...payload, totalAmountMinor: 0 })).rejects.toMatchObject({
      code: "functions/invalid-argument",
    });
    await expect(reviewInvoiceRecord({
      invoiceId,
      status: "approved",
      reviewNotes: "Builder cannot approve",
    })).rejects.toMatchObject({ code: "functions/permission-denied" });

    const forgedInvoiceId = doc(collection(firebaseDb, "invoices")).id;
    const forgedQuarantinePath = buildPrivateStoragePath(
      "invoice-quarantine",
      builder.uid,
      forgedInvoiceId,
      "upload",
    );
    await uploadPrivateFile(
      forgedQuarantinePath,
      new Blob(["not-a-png"], { type: "image/png" }),
      { contentType: "image/png" },
    );
    await expect(submitInvoiceRecord({
      ...payload,
      invoiceId: forgedInvoiceId,
      quarantinePath: forgedQuarantinePath,
      originalFileName: "forged.png",
    })).rejects.toMatchObject({ code: "functions/invalid-argument" });

    await signOut();
    await signIn(managerCredentials.email, managerCredentials.password);

    const review = { invoiceId, status: "approved" as const, reviewNotes: "Matched to project" };
    await expect(reviewInvoiceRecord(review)).resolves.toEqual({ invoiceId, status: "approved" });
    await expect(reviewInvoiceRecord(review)).resolves.toEqual({ invoiceId, status: "approved" });
    await expect(reviewInvoiceRecord({ ...review, status: "rejected" })).rejects.toMatchObject({
      code: "functions/failed-precondition",
    });
  }, 20_000);

  test("rate-limits repeated manager invitation requests per user", async () => {
    const managerCredentials = credentials("rate-limit-manager");
    await provisionEmulatorUser({
      email: managerCredentials.email,
      password: managerCredentials.password,
      displayName: managerCredentials.fullName,
      role: "manager",
    });
    await signIn(managerCredentials.email, managerCredentials.password);

    for (let attempt = 0; attempt < 10; attempt += 1) {
      await expect(invitationOperations.createInvitation({
        role: "builder",
        targetEmail: `rate-limit-target-${attempt}-${Date.now()}@example.test`,
      })).resolves.toBeDefined();
    }
    await expect(invitationOperations.createInvitation({
      role: "builder",
      targetEmail: `rate-limit-target-blocked-${Date.now()}@example.test`,
    })).rejects.toMatchObject({
      code: "functions/resource-exhausted",
    });
  }, 20_000);

  test("rate-limits public invitation validation before unbounded Firestore lookups", async () => {
    await signOut();
    await clearPublicInvitationRateLimits();

    try {
      for (let attempt = 0; attempt < 30; attempt += 1) {
        await expect(
          invitationOperations.validateInvitationCode("000000000000"),
        ).resolves.toMatchObject({ valid: false });
      }
      await expect(
        invitationOperations.validateInvitationCode("000000000000"),
      ).rejects.toMatchObject({ code: "functions/resource-exhausted" });
    } finally {
      await clearPublicInvitationRateLimits();
    }
  }, 20_000);

  test("imports spreadsheet jobs idempotently for managers", async () => {
    const builderCredentials = credentials("spreadsheet-builder");
    const builder = await provisionEmulatorUser({
      email: builderCredentials.email,
      password: builderCredentials.password,
      displayName: builderCredentials.fullName,
      role: "builder",
    });
    const managerCredentials = credentials("spreadsheet-manager");
    const manager = await provisionEmulatorUser({
      email: managerCredentials.email,
      password: managerCredentials.password,
      displayName: managerCredentials.fullName,
      role: "manager",
    });
    await signIn(managerCredentials.email, managerCredentials.password);

    const project = await createProject({
      builderId: builder.uid,
      name: "Spreadsheet import project",
      clientName: "Spreadsheet client",
    });
    const filePath = `job-imports/${manager.uid}/jobs.csv`;
    await uploadPrivateFile(
      filePath,
      new Blob([
        "Title,Description,Section\nInstall vanity,Double sink,Bathroom\nPaint walls,,Living Room",
      ], { type: "text/csv" }),
      { contentType: "text/csv" },
    );

    const first = await extractJobsFromExcelRecord({ projectId: project.id, filePath });
    const second = await extractJobsFromExcelRecord({ projectId: project.id, filePath });
    expect(first.createdJobIds).toHaveLength(2);
    expect(second).toEqual(first);
    const importedJob = await getDoc(doc(firebaseDb, "jobs", first.createdJobIds[0]));
    expect(importedJob.exists()).toBe(true);
  }, 30_000);
});
