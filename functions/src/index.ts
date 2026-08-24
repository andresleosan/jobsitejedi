import { createHash, randomBytes } from "node:crypto";
import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";

initializeApp();

type AppRole = "manager" | "builder";
type InvitationStatus = "pending" | "used";

const INVITATION_TTL_MS = 5 * 60 * 1000;
const INVITATION_CODE_LENGTH = 12;

const isAppRole = (value: unknown): value is AppRole =>
  value === "manager" || value === "builder";

const isInvitationStatus = (value: unknown): value is InvitationStatus =>
  value === "pending" || value === "used";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const normalizeInvitationCode = (value: unknown): string => {
  if (typeof value !== "string") return "";
  const code = value.trim().toUpperCase();
  return /^[A-Z0-9]{12}$/.test(code) ? code : "";
};

const hashInvitationCode = (code: string): string =>
  createHash("sha256").update(code).digest("hex");

const createInvitationCode = (): string =>
  randomBytes(INVITATION_CODE_LENGTH / 2).toString("hex").toUpperCase();

const invalidInvitation = () => ({
  valid: false,
  role: "builder" as const,
  invitationId: "",
  errorMessage: "Invitation code is invalid or expired",
});

const getRolePayload = (value: unknown): { userId: string; role: AppRole } => {
  if (!isRecord(value) || typeof value.userId !== "string" || !isAppRole(value.role)) {
    throw new HttpsError("invalid-argument", "A valid userId and role are required");
  }

  const userId = value.userId.trim();
  if (!userId) {
    throw new HttpsError("invalid-argument", "A valid userId and role are required");
  }

  return { userId, role: value.role };
};

const wait = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

const getUserWithRetry = async (userId: string) => {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      return await getAuth().getUser(userId);
    } catch (error) {
      if (
        typeof error !== "object" ||
        error === null ||
        !("code" in error) ||
        error.code !== "auth/user-not-found" ||
        attempt === 4
      ) {
        throw new HttpsError("internal", "Unable to load the authenticated user");
      }

      await wait(50 * (attempt + 1));
    }
  }

  throw new HttpsError("internal", "Unable to load the authenticated user");
};

export const ensureBuilderRole = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication is required");
  }

  if (!isRecord(request.data) || request.data.role !== "builder") {
    throw new HttpsError("invalid-argument", "Only the builder role can be self-assigned");
  }

  const auth = getAuth();
  const user = await getUserWithRetry(request.auth.uid);
  const currentRole = user.customClaims?.role;

  if (currentRole !== undefined && currentRole !== "builder") {
    throw new HttpsError("permission-denied", "The current role cannot be changed this way");
  }

  await auth.setCustomUserClaims(request.auth.uid, {
    ...user.customClaims,
    role: "builder",
  });

  return { role: "builder" as const };
});

export const setUserRole = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication is required");
  }

  if (request.auth.token.role !== "manager") {
    throw new HttpsError("permission-denied", "Manager role is required");
  }

  const { userId, role } = getRolePayload(request.data);
  const auth = getAuth();
  const user = await getUserWithRetry(userId);

  await auth.setCustomUserClaims(userId, {
    ...user.customClaims,
    role,
  });

  return { userId, role };
});

export const createManagerInvitation = onCall(async (request) => {
  if (!request.auth || request.auth.token.role !== "manager") {
    throw new HttpsError("permission-denied", "Manager role is required");
  }

  if (!isRecord(request.data) || !isAppRole(request.data.role)) {
    throw new HttpsError("invalid-argument", "A valid invitation role is required");
  }

  const code = createInvitationCode();
  const expiresAt = Timestamp.fromMillis(Date.now() + INVITATION_TTL_MS);
  await getFirestore().collection("invitations").add({
    codeHash: hashInvitationCode(code),
    role: request.data.role,
    status: "pending" as const,
    createdBy: request.auth.uid,
    createdAt: Timestamp.now(),
    expiresAt,
    usedBy: null,
    usedAt: null,
  });

  return { code, expiresAt: expiresAt.toDate().toISOString() };
});

export const validateInvitationCode = onCall(async (request) => {
  const code = normalizeInvitationCode(isRecord(request.data) ? request.data.code : request.data);
  if (!code) return invalidInvitation();

  const snapshot = await getFirestore()
    .collection("invitations")
    .where("codeHash", "==", hashInvitationCode(code))
    .limit(1)
    .get();
  if (snapshot.empty) return invalidInvitation();

  const invitation = snapshot.docs[0];
  const data = invitation.data();
  const expiresAt = data.expiresAt instanceof Timestamp ? data.expiresAt.toMillis() : 0;
  if (!isAppRole(data.role) || !isInvitationStatus(data.status) || data.status !== "pending" || expiresAt <= Date.now()) {
    return invalidInvitation();
  }

  return {
    valid: true,
    role: data.role,
    invitationId: invitation.id,
    errorMessage: null,
  };
});

export const consumeInvitation = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication is required");
  }
  if (!isRecord(request.data) || typeof request.data.invitationId !== "string" || !request.data.invitationId.trim()) {
    throw new HttpsError("invalid-argument", "A valid invitationId is required");
  }

  const auth = getAuth();
  const firestore = getFirestore();
  const userId = request.auth.uid;
  const invitationRef = firestore.collection("invitations").doc(request.data.invitationId.trim());
  const user = await getUserWithRetry(userId);
  const currentRole = user.customClaims?.role;

  const role = await firestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(invitationRef);
    if (!snapshot.exists) throw new HttpsError("not-found", "Invitation was not found");
    const data = snapshot.data() ?? {};
    const expiresAt = data.expiresAt instanceof Timestamp ? data.expiresAt.toMillis() : 0;
    if (!isAppRole(data.role) || !isInvitationStatus(data.status) || data.status !== "pending" || expiresAt <= Date.now()) {
      throw new HttpsError("failed-precondition", "Invitation is invalid or expired");
    }
    if (currentRole && currentRole !== data.role) {
      throw new HttpsError("permission-denied", "The invitation role conflicts with the current account");
    }

    transaction.update(invitationRef, {
      status: "used" as const,
      usedBy: userId,
      usedAt: Timestamp.now(),
    });
    return data.role;
  });

  await auth.setCustomUserClaims(userId, {
    ...user.customClaims,
    role,
  });
  return { role };
});
