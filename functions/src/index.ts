import { createHash, randomBytes } from "node:crypto";
import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { HttpsError, onCall } from "firebase-functions/v2/https";

initializeApp();

type AppRole = "manager" | "builder";
type InvitationStatus = "pending" | "used";
type InvoiceStatus = "submitted" | "approved" | "rejected";

interface InvoicePayload {
  invoiceId: string;
  projectId: string;
  invoiceNumber: string;
  supplierName: string;
  invoiceDate: string;
  totalAmountMinor: number;
  currency: "GBP";
  notes: string | null;
  filePath: string;
  fileName: string;
}

const INVITATION_TTL_MS = 5 * 60 * 1000;
const INVITATION_CODE_LENGTH = 12;

const isAppRole = (value: unknown): value is AppRole =>
  value === "manager" || value === "builder";

const isInvitationStatus = (value: unknown): value is InvitationStatus =>
  value === "pending" || value === "used";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const requireText = (
  value: unknown,
  label: string,
  maximumLength: number,
): string => {
  if (typeof value !== "string") {
    throw new HttpsError("invalid-argument", `${label} is required`);
  }
  const normalized = value.trim();
  if (
    !normalized ||
    normalized.length > maximumLength ||
    [...normalized].some((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint < 32 || codePoint === 127;
    })
  ) {
    throw new HttpsError("invalid-argument", `${label} is invalid`);
  }
  return normalized;
};

const isIsoDate = (value: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
};

const getInvoicePayload = (value: unknown, userId: string): InvoicePayload => {
  if (!isRecord(value)) {
    throw new HttpsError("invalid-argument", "Invoice details are required");
  }

  const invoiceId = requireText(value.invoiceId, "Invoice id", 128);
  if (!/^[A-Za-z0-9_-]{10,128}$/.test(invoiceId)) {
    throw new HttpsError("invalid-argument", "Invoice id is invalid");
  }
  const projectId = requireText(value.projectId, "Project id", 128);
  const invoiceNumber = requireText(value.invoiceNumber, "Invoice number", 80);
  const supplierName = requireText(value.supplierName, "Supplier name", 120);
  const invoiceDate = requireText(value.invoiceDate, "Invoice date", 10);
  if (!isIsoDate(invoiceDate)) {
    throw new HttpsError("invalid-argument", "Invoice date must be a valid ISO date");
  }
  if (
    typeof value.totalAmountMinor !== "number" ||
    !Number.isSafeInteger(value.totalAmountMinor) ||
    value.totalAmountMinor <= 0 ||
    value.totalAmountMinor > 1_000_000_000_000
  ) {
    throw new HttpsError("invalid-argument", "Invoice amount is invalid");
  }
  if (value.currency !== "GBP") {
    throw new HttpsError("invalid-argument", "Invoice currency must be GBP");
  }
  const notes = value.notes == null || value.notes === ""
    ? null
    : requireText(value.notes, "Invoice notes", 1_000);
  const fileName = requireText(value.fileName, "Invoice file name", 180);
  const filePath = requireText(value.filePath, "Invoice file path", 500);
  const expectedPrefix = `invoices/${userId}/${invoiceId}/`;
  if (
    !filePath.startsWith(expectedPrefix) ||
    filePath.slice(expectedPrefix.length).includes("/") ||
    !/^[A-Za-z0-9._-]+$/.test(filePath.slice(expectedPrefix.length))
  ) {
    throw new HttpsError("invalid-argument", "Invoice file path is invalid");
  }

  return {
    invoiceId,
    projectId,
    invoiceNumber,
    supplierName,
    invoiceDate,
    totalAmountMinor: value.totalAmountMinor,
    currency: "GBP",
    notes,
    filePath,
    fileName,
  };
};

const invoiceMatchesPayload = (
  current: Record<string, unknown>,
  payload: InvoicePayload,
  userId: string,
): boolean =>
  current.uploadedBy === userId &&
  current.projectId === payload.projectId &&
  current.invoiceNumber === payload.invoiceNumber &&
  current.supplierName === payload.supplierName &&
  current.invoiceDate === payload.invoiceDate &&
  current.totalAmountMinor === payload.totalAmountMinor &&
  current.currency === payload.currency &&
  current.notes === payload.notes &&
  current.filePath === payload.filePath &&
  current.fileName === payload.fileName;

const getReviewPayload = (value: unknown): {
  invoiceId: string;
  status: Exclude<InvoiceStatus, "submitted">;
  reviewNotes: string | null;
} => {
  if (!isRecord(value)) {
    throw new HttpsError("invalid-argument", "Invoice review details are required");
  }
  const invoiceId = requireText(value.invoiceId, "Invoice id", 128);
  if (!/^[A-Za-z0-9_-]{10,128}$/.test(invoiceId)) {
    throw new HttpsError("invalid-argument", "Invoice id is invalid");
  }
  if (value.status !== "approved" && value.status !== "rejected") {
    throw new HttpsError("invalid-argument", "Invoice review status is invalid");
  }
  const reviewNotes = value.reviewNotes == null || value.reviewNotes === ""
    ? null
    : requireText(value.reviewNotes, "Review notes", 1_000);
  return { invoiceId, status: value.status, reviewNotes };
};

const getInvoiceStorageBucket = () => {
  const emulatorProjectId = process.env.FIREBASE_STORAGE_EMULATOR_HOST
    ? process.env.GCLOUD_PROJECT
    : undefined;
  return emulatorProjectId
    ? getStorage().bucket(emulatorProjectId)
    : getStorage().bucket();
};

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

export const submitInvoice = onCall(
  { timeoutSeconds: 30, memory: "256MiB", maxInstances: 10 },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Authentication is required");
    }
    if (request.auth.token.role !== "builder") {
      throw new HttpsError("permission-denied", "Builder role is required");
    }

    const userId = request.auth.uid;
    const uploadedByName = typeof request.auth.token.name === "string"
      ? request.auth.token.name
      : null;
    const payload = getInvoicePayload(request.data, userId);
    const firestore = getFirestore();
    const invoiceRef = firestore.collection("invoices").doc(payload.invoiceId);
    const existing = await invoiceRef.get();
    if (existing.exists) {
      const current = existing.data() ?? {};
      if (!invoiceMatchesPayload(current, payload, userId)) {
        throw new HttpsError("already-exists", "Invoice id is already in use");
      }
      return { invoiceId: payload.invoiceId, status: current.status as InvoiceStatus };
    }

    let metadata;
    try {
      [metadata] = await getInvoiceStorageBucket().file(payload.filePath).getMetadata();
    } catch {
      throw new HttpsError("failed-precondition", "Invoice file was not found");
    }
    const fileSize = Number(metadata.size);
    const contentType = metadata.contentType ?? "";
    const fileGeneration = String(metadata.generation ?? "");
    if (
      !Number.isSafeInteger(fileSize) ||
      fileSize <= 0 ||
      fileSize >= 10 * 1024 * 1024 ||
      !(contentType === "application/pdf" || contentType.startsWith("image/")) ||
      !fileGeneration
    ) {
      throw new HttpsError("failed-precondition", "Invoice file metadata is invalid");
    }

    const status = await firestore.runTransaction(async (transaction) => {
      const [invoiceSnapshot, projectSnapshot] = await Promise.all([
        transaction.get(invoiceRef),
        transaction.get(firestore.collection("projects").doc(payload.projectId)),
      ]);
      if (!projectSnapshot.exists || projectSnapshot.data()?.ownerId !== userId) {
        throw new HttpsError("permission-denied", "The selected project does not belong to this builder");
      }
      if (invoiceSnapshot.exists) {
        const current = invoiceSnapshot.data() ?? {};
        if (!invoiceMatchesPayload(current, payload, userId)) {
          throw new HttpsError("already-exists", "Invoice id is already in use");
        }
        return current.status as InvoiceStatus;
      }

      transaction.create(invoiceRef, {
        projectId: payload.projectId,
        projectName: String(projectSnapshot.data()?.name ?? ""),
        invoiceNumber: payload.invoiceNumber,
        supplierName: payload.supplierName,
        invoiceDate: payload.invoiceDate,
        totalAmountMinor: payload.totalAmountMinor,
        currency: payload.currency,
        notes: payload.notes,
        filePath: payload.filePath,
        fileName: payload.fileName,
        contentType,
        fileSize,
        fileGeneration,
        fileMd5Hash: metadata.md5Hash ?? null,
        uploadedBy: userId,
        uploadedByName,
        status: "submitted" as const,
        reviewedBy: null,
        reviewedAt: null,
        reviewNotes: null,
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
      });
      return "submitted" as const;
    });

    return { invoiceId: payload.invoiceId, status };
  },
);

export const reviewInvoice = onCall(
  { timeoutSeconds: 15, memory: "256MiB", maxInstances: 10 },
  async (request) => {
    if (!request.auth || request.auth.token.role !== "manager") {
      throw new HttpsError("permission-denied", "Manager role is required");
    }
    const managerId = request.auth.uid;
    const payload = getReviewPayload(request.data);
    const invoiceRef = getFirestore().collection("invoices").doc(payload.invoiceId);
    const status = await getFirestore().runTransaction(async (transaction) => {
      const snapshot = await transaction.get(invoiceRef);
      if (!snapshot.exists) throw new HttpsError("not-found", "Invoice was not found");
      const current = snapshot.data() ?? {};
      if (
        current.status === payload.status &&
        current.reviewedBy === managerId &&
        current.reviewNotes === payload.reviewNotes
      ) {
        return payload.status;
      }
      if (current.status !== "submitted") {
        throw new HttpsError("failed-precondition", "Invoice has already been reviewed");
      }
      transaction.update(invoiceRef, {
        status: payload.status,
        reviewedBy: managerId,
        reviewedAt: Timestamp.now(),
        reviewNotes: payload.reviewNotes,
        updatedAt: Timestamp.now(),
      });
      return payload.status;
    });
    return { invoiceId: payload.invoiceId, status };
  },
);
