import { createHash, randomBytes } from "node:crypto";
import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, Timestamp, type DocumentReference } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { setGlobalOptions } from "firebase-functions/v2";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import {
  MAX_SPREADSHEET_BYTES,
  MAX_SPREADSHEET_ROWS,
  SpreadsheetParseError,
  parseSpreadsheet,
} from "./spreadsheet.js";

setGlobalOptions({ region: "europe-west1" });

initializeApp();

type AppRole = "manager" | "builder";
type InvitationStatus = "pending" | "used";
type InvoiceStatus = "submitted" | "approved" | "rejected";
type JobImportStatus = "processing" | "completed" | "failed";

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

interface JobImportPayload {
  projectId: string;
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

const getJobImportPayload = (value: unknown, managerId: string): JobImportPayload => {
  if (!isRecord(value)) {
    throw new HttpsError("invalid-argument", "Spreadsheet import details are required");
  }
  const projectId = requireText(value.projectId, "Project id", 128);
  const filePath = requireText(value.filePath, "Spreadsheet file path", 500);
  const expectedPrefix = `job-imports/${managerId}/`;
  const fileName = filePath.slice(expectedPrefix.length);
  if (
    !filePath.startsWith(expectedPrefix)
    || !fileName
    || fileName.includes("/")
    || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,179}$/.test(fileName)
    || fileName.startsWith(".")
    || !/\.(csv|tsv|xlsx)$/i.test(fileName)
  ) {
    throw new HttpsError("invalid-argument", "Spreadsheet file path is invalid");
  }
  return { projectId, filePath, fileName };
};

const wait = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

type RateLimitOperation =
  | "ensureBuilderRole"
  | "setUserRole"
  | "createManagerInvitation"
  | "validateInvitationCode"
  | "consumeInvitation"
  | "extractJobsFromExcel"
  | "submitInvoice"
  | "reviewInvoice";

const RATE_LIMITS: Record<RateLimitOperation, { maxRequests: number; windowMs: number }> = {
  ensureBuilderRole: { maxRequests: 5, windowMs: 60 * 60 * 1000 },
  setUserRole: { maxRequests: 30, windowMs: 60 * 1000 },
  createManagerInvitation: { maxRequests: 10, windowMs: 60 * 1000 },
  validateInvitationCode: { maxRequests: 30, windowMs: 60 * 1000 },
  consumeInvitation: { maxRequests: 5, windowMs: 15 * 60 * 1000 },
  extractJobsFromExcel: { maxRequests: 5, windowMs: 60 * 60 * 1000 },
  submitInvoice: { maxRequests: 10, windowMs: 10 * 60 * 1000 },
  reviewInvoice: { maxRequests: 30, windowMs: 60 * 1000 },
};

const getRateLimitReference = (operation: RateLimitOperation, userId: string) =>
  getFirestore()
    .collection("functionRateLimits")
    .doc(createHash("sha256").update(`${operation}:${userId}`).digest("hex"));

const enforceRateLimit = async (
  subjectId: string,
  operation: RateLimitOperation,
): Promise<void> => {
  const policy = RATE_LIMITS[operation];
  const now = Date.now();
  const reference = getRateLimitReference(operation, subjectId);

  await getFirestore().runTransaction(async (transaction) => {
    const snapshot = await transaction.get(reference);
    const data = snapshot.data() ?? {};
    const startedAt = data.windowStartedAt instanceof Timestamp
      ? data.windowStartedAt.toMillis()
      : 0;
    const requestCount = Number.isSafeInteger(data.requestCount) ? data.requestCount : 0;

    if (startedAt <= 0 || now - startedAt >= policy.windowMs || requestCount < 0) {
      transaction.set(reference, {
        operation,
        windowStartedAt: Timestamp.fromMillis(now),
        requestCount: 1,
        updatedAt: Timestamp.fromMillis(now),
      });
      return;
    }

    if (requestCount >= policy.maxRequests) {
      throw new HttpsError("resource-exhausted", "Too many requests; please try again later");
    }

    transaction.update(reference, {
      requestCount: requestCount + 1,
      updatedAt: Timestamp.fromMillis(now),
    });
  });
};

const assignClaimsOrCompensate = async (
  userId: string,
  claims: Record<string, unknown>,
  invitationReference?: DocumentReference,
): Promise<void> => {
  try {
    await getAuth().setCustomUserClaims(userId, claims);
  } catch {
    if (invitationReference) {
      try {
        await getFirestore().runTransaction(async (transaction) => {
          const snapshot = await transaction.get(invitationReference);
          const data = snapshot.data() ?? {};
          if (snapshot.exists && data.status === "used" && data.usedBy === userId) {
            transaction.update(invitationReference, {
              status: "pending" as const,
              usedBy: null,
              usedAt: null,
            });
          }
        });
      } catch {
        console.error("Role assignment compensation failed", {
          operation: "consumeInvitation",
        });
      }
    }

    throw new HttpsError("internal", "Unable to assign the account role; please retry");
  }
};

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

  await enforceRateLimit(request.auth.uid, "ensureBuilderRole");

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
  await enforceRateLimit(request.auth.uid, "setUserRole");
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

  await enforceRateLimit(request.auth.uid, "createManagerInvitation");

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

export const validateInvitationCode = onCall(
  { timeoutSeconds: 10, memory: "256MiB", maxInstances: 2 },
  async (request) => {
    // This endpoint must remain public so a new user can validate an invitation
    // before authenticating. A global quota bounds unauthenticated Firestore
    // lookups until App Check enforcement is enabled in production.
    await enforceRateLimit("public", "validateInvitationCode");

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
  },
);

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
  await enforceRateLimit(userId, "consumeInvitation");
  const user = await getUserWithRetry(userId);
  const currentRole = user.customClaims?.role;
  let alreadyConsumed = false;

  const role = await firestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(invitationRef);
    if (!snapshot.exists) throw new HttpsError("not-found", "Invitation was not found");
    const data = snapshot.data() ?? {};
    const expiresAt = data.expiresAt instanceof Timestamp ? data.expiresAt.toMillis() : 0;
    if (!isAppRole(data.role) || !isInvitationStatus(data.status) || expiresAt <= Date.now()) {
      throw new HttpsError("failed-precondition", "Invitation is invalid or expired");
    }
    if (data.status === "used" && data.usedBy === userId && currentRole === data.role) {
      alreadyConsumed = true;
      return data.role;
    }
    if (data.status !== "pending") {
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

  if (!alreadyConsumed) {
    await assignClaimsOrCompensate(
      userId,
      { ...user.customClaims, role },
      invitationRef,
    );
  }
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
    await enforceRateLimit(userId, "submitInvoice");
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

const SPREADSHEET_CONTENT_TYPES = new Set([
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "text/csv",
  "text/tab-separated-values",
  "application/csv",
]);
const IMPORT_LOCK_TTL_MS = 10 * 60 * 1000;

export const extractJobsFromExcel = onCall(
  { timeoutSeconds: 60, memory: "256MiB", maxInstances: 5 },
  async (request) => {
    if (!request.auth || request.auth.token.role !== "manager") {
      throw new HttpsError("permission-denied", "Manager role is required");
    }

    const managerId = request.auth.uid;
    await enforceRateLimit(managerId, "extractJobsFromExcel");
    const payload = getJobImportPayload(request.data, managerId);
    const firestore = getFirestore();
    const projectSnapshot = await firestore.collection("projects").doc(payload.projectId).get();
    if (!projectSnapshot.exists) {
      throw new HttpsError("not-found", "Project was not found");
    }
    const projectData = projectSnapshot.data() ?? {};
    const builderId = typeof projectData.ownerId === "string" ? projectData.ownerId.trim() : "";
    if (!builderId) {
      throw new HttpsError("failed-precondition", "The project has no builder owner");
    }

    const file = getInvoiceStorageBucket().file(payload.filePath);
    let metadata;
    try {
      [metadata] = await file.getMetadata();
    } catch {
      throw new HttpsError("failed-precondition", "Spreadsheet file was not found");
    }
    const fileSize = Number(metadata.size);
    const contentType = String(metadata.contentType ?? "").toLowerCase();
    if (
      !Number.isSafeInteger(fileSize)
      || fileSize <= 0
      || fileSize > MAX_SPREADSHEET_BYTES
      || !SPREADSHEET_CONTENT_TYPES.has(contentType)
    ) {
      throw new HttpsError("invalid-argument", "Spreadsheet file metadata is invalid");
    }

    let contents: Buffer;
    try {
      [contents] = await file.download();
    } catch {
      throw new HttpsError("failed-precondition", "Spreadsheet file could not be read");
    }
    if (contents.length !== fileSize || contents.length > MAX_SPREADSHEET_BYTES) {
      throw new HttpsError("failed-precondition", "Spreadsheet file size is invalid");
    }

    let importedJobs;
    try {
      importedJobs = parseSpreadsheet(contents, contentType, payload.fileName);
    } catch (error) {
      if (error instanceof SpreadsheetParseError) {
        throw new HttpsError("invalid-argument", "Spreadsheet content is invalid");
      }
      throw new HttpsError("internal", "Spreadsheet could not be processed");
    }
    if (importedJobs.length === 0) {
      throw new HttpsError("invalid-argument", "Spreadsheet does not contain any jobs");
    }
    if (importedJobs.length > MAX_SPREADSHEET_ROWS) {
      throw new HttpsError("invalid-argument", "Spreadsheet has too many jobs");
    }

    const importId = createHash("sha256")
      .update(`${managerId}:${payload.projectId}:`)
      .update(contents)
      .digest("hex");
    const importReference = firestore.collection("jobImports").doc(importId);
    const now = Date.now();
    let claimed = false;
    const claim = await firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(importReference);
      const data = snapshot.data() ?? {};
      if (data.status === "completed" && Array.isArray(data.createdJobIds)) {
        return {
          completed: true,
          createdJobIds: data.createdJobIds.filter((id): id is string => typeof id === "string"),
        };
      }

      const startedAt = data.startedAt instanceof Timestamp ? data.startedAt.toMillis() : 0;
      if (data.status === "processing" && startedAt > now - IMPORT_LOCK_TTL_MS) {
        throw new HttpsError("already-exists", "This spreadsheet import is already in progress");
      }

      transaction.set(importReference, {
        managerId,
        projectId: payload.projectId,
        filePath: payload.filePath,
        fileHash: createHash("sha256").update(contents).digest("hex"),
        status: "processing" as JobImportStatus,
        rowCount: importedJobs.length,
        createdJobIds: [],
        startedAt: Timestamp.fromMillis(now),
        updatedAt: Timestamp.fromMillis(now),
      });
      return { completed: false, createdJobIds: [] };
    });
    if (claim.completed) {
      return { importId, createdJobIds: claim.createdJobIds };
    }
    claimed = true;

    try {
      const jobReferences = importedJobs.map((_, index) =>
        firestore.collection("jobs").doc(`${importId}-${String(index + 1).padStart(3, "0")}`));
      const existingJobs = await firestore.getAll(...jobReferences);
      const batch = firestore.batch();
      const createdJobIds: string[] = [];

      existingJobs.forEach((snapshot, index) => {
        const reference = jobReferences[index];
        const importedJob = importedJobs[index];
        if (snapshot.exists) {
          const data = snapshot.data() ?? {};
          if (
            data.importId !== importId
            || data.projectId !== payload.projectId
            || data.builderId !== builderId
            || data.title !== importedJob.title
          ) {
            throw new HttpsError("already-exists", "A generated job id is already in use");
          }
        } else {
          batch.create(reference, {
            projectId: payload.projectId,
            builderId,
            title: importedJob.title,
            description: importedJob.description,
            section: importedJob.section,
            status: "approved",
            reviewNotes: null,
            reviewedBy: null,
            reviewedAt: null,
            importId,
            importRow: index + 1,
            createdAt: Timestamp.now(),
            updatedAt: Timestamp.now(),
          });
        }
        createdJobIds.push(reference.id);
      });

      if (createdJobIds.length > 0 && existingJobs.some((snapshot) => !snapshot.exists)) {
        await batch.commit();
      }
      await importReference.set({
        status: "completed" as JobImportStatus,
        createdJobIds,
        completedAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
      }, { merge: true });
      return { importId, createdJobIds };
    } catch (error) {
      await importReference.set({
        status: "failed" as JobImportStatus,
        failureCode: error instanceof HttpsError ? error.code : "internal",
        updatedAt: Timestamp.now(),
      }, { merge: true }).catch(() => undefined);
      if (error instanceof HttpsError) throw error;
      console.error("Spreadsheet job import failed", { operation: "extractJobsFromExcel" });
      throw new HttpsError("internal", "Spreadsheet import could not be completed");
    }
  },
);

export const reviewInvoice = onCall(
  { timeoutSeconds: 15, memory: "256MiB", maxInstances: 10 },
  async (request) => {
    if (!request.auth || request.auth.token.role !== "manager") {
      throw new HttpsError("permission-denied", "Manager role is required");
    }
    const managerId = request.auth.uid;
    await enforceRateLimit(managerId, "reviewInvoice");
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

const CLEANUP_BATCH_LIMIT = 100;
const RATE_LIMIT_RETENTION_MS = 24 * 60 * 60 * 1000;
const PROJECT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

const hasProjectRecords = async (projectId: string): Promise<boolean> => {
  const firestore = getFirestore();
  const projectScopedCollections = [
    "jobs",
    "timeTracking",
    "invoices",
    "materialUsage",
    "materialDeliveryRequests",
    "rubbishCollectionRequests",
    "toolRequests",
  ];

  for (const collectionName of projectScopedCollections) {
    const snapshot = await firestore
      .collection(collectionName)
      .where("projectId", "==", projectId)
      .limit(1)
      .get();
    if (!snapshot.empty) return true;
  }

  const [incomingSwitches, outgoingSwitches] = await Promise.all([
    firestore.collection("projectSwitches").where("toProjectId", "==", projectId).limit(1).get(),
    firestore.collection("projectSwitches").where("fromProjectId", "==", projectId).limit(1).get(),
  ]);
  return !incomingSwitches.empty || !outgoingSwitches.empty;
};

export const cleanupOldProjects = onSchedule(
  {
    schedule: "every 24 hours",
    timeZone: "Etc/UTC",
    timeoutSeconds: 60,
    memory: "256MiB",
    maxInstances: 1,
    retryCount: 3,
  },
  async () => {
    const firestore = getFirestore();
    const now = Date.now();
    const staleInvitationSnapshot = await firestore
      .collection("invitations")
      .where("expiresAt", "<=", Timestamp.fromMillis(now - RATE_LIMIT_RETENTION_MS))
      .limit(CLEANUP_BATCH_LIMIT)
      .get();
    const staleRateLimitSnapshot = await firestore
      .collection("functionRateLimits")
      .where("updatedAt", "<=", Timestamp.fromMillis(now - RATE_LIMIT_RETENTION_MS))
      .limit(CLEANUP_BATCH_LIMIT)
      .get();

    const cleanupBatch = firestore.batch();
    staleInvitationSnapshot.docs.forEach((snapshot) => cleanupBatch.delete(snapshot.ref));
    staleRateLimitSnapshot.docs.forEach((snapshot) => cleanupBatch.delete(snapshot.ref));
    if (!staleInvitationSnapshot.empty || !staleRateLimitSnapshot.empty) {
      await cleanupBatch.commit();
    }

    let deletedProjects = 0;
    // Project deletion is deliberately opt-in. A missing flag makes the schedule
    // clean only ephemeral control records, never business data.
    if (process.env.ENABLE_PROJECT_CLEANUP === "true") {
      const projectSnapshot = await firestore
        .collection("projects")
        .where("status", "==", "finished")
        .limit(CLEANUP_BATCH_LIMIT)
        .get();
      const retentionCutoff = now - PROJECT_RETENTION_MS;

      for (const project of projectSnapshot.docs) {
        const data = project.data();
        const cleanupEligibleAt = data.cleanupEligibleAt instanceof Timestamp
          ? data.cleanupEligibleAt.toMillis()
          : 0;
        if (cleanupEligibleAt <= 0 || cleanupEligibleAt > retentionCutoff) continue;
        if (await hasProjectRecords(project.id)) continue;

        await firestore.runTransaction(async (transaction) => {
          const current = await transaction.get(project.ref);
          const currentData = current.data() ?? {};
          const currentEligibleAt = currentData.cleanupEligibleAt instanceof Timestamp
            ? currentData.cleanupEligibleAt.toMillis()
            : 0;
          if (
            current.exists
            && currentData.status === "finished"
            && currentEligibleAt > 0
            && currentEligibleAt <= retentionCutoff
          ) {
            transaction.delete(project.ref);
            deletedProjects += 1;
          }
        });
      }
    }

    console.log("Scheduled cleanup completed", {
      expiredInvitations: staleInvitationSnapshot.size,
      staleRateLimits: staleRateLimitSnapshot.size,
      deletedProjects,
    });
  },
);
