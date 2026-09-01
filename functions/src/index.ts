import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { initializeApp } from "firebase-admin/app";
import { getAuth, type UserRecord } from "firebase-admin/auth";
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
import { MAX_INVOICE_FILE_BYTES, sanitizeInvoiceFile } from "./invoice-file.js";
import { hasCurrentAuthSession, hasRecentAuthentication } from "./auth-session.js";

setGlobalOptions({ region: "europe-west1" });

// Evaluated only while Firebase discovers the deployment manifest. The release
// command must opt in explicitly after the observation gate; absence is safe.
const ENFORCE_APP_CHECK = process.env.ENFORCE_APP_CHECK === "true";
const appCheckOptions = { enforceAppCheck: ENFORCE_APP_CHECK } as const;

initializeApp();

type AppRole = "admin" | "manager" | "builder";
type InvitationStatus = "pending" | "used";
type InvitationClaimAssignmentState = "not_started" | "pending" | "completed" | "failed";
type InvitationTargetStatus = "pending" | "assigning" | "completed" | "failed";
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
  quarantinePath: string;
  originalFileName: string;
}

interface JobImportPayload {
  projectId: string;
  filePath: string;
  fileName: string;
}

interface AssignedProjectPayload {
  projectId: string;
  builderId: string;
  name: string;
  description: string | null;
  clientName: string;
  address: string | null;
}

const INVITATION_TTL_MS = 30 * 60 * 1000;
const INVITATION_ASSIGNMENT_RECOVERY_MS = 2 * 60 * 1000;
const INVITATION_CODE_LENGTH = 12;
const INVITATION_SCHEMA_VERSION = 4;
const INVITATION_EMAIL_SALT_BYTES = 16;
const INVITATION_ENROLLMENT_ID_BYTES = 16;
const INVITATION_REQUEST_KEY_BYTES = 32;
const AUTHORIZATION_GRANT_ID_BYTES = 16;

const isAppRole = (value: unknown): value is AppRole =>
  value === "admin" || value === "manager" || value === "builder";

const isManagementRole = (value: unknown): value is "admin" | "manager" =>
  value === "admin" || value === "manager";

const canInviteRole = (actorRole: "admin" | "manager", targetRole: AppRole): boolean =>
  targetRole === "builder" || (actorRole === "admin" && targetRole === "manager");


const isInvitationStatus = (value: unknown): value is InvitationStatus =>
  value === "pending" || value === "used";

const isInvitationClaimAssignmentState = (
  value: unknown,
): value is InvitationClaimAssignmentState =>
  value === "not_started"
  || value === "pending"
  || value === "completed"
  || value === "failed";

const isInvitationTargetStatus = (value: unknown): value is InvitationTargetStatus =>
  value === "pending" || value === "assigning" || value === "completed" || value === "failed";

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
  const originalFileName = requireText(value.originalFileName, "Invoice file name", 180);
  const quarantinePath = requireText(value.quarantinePath, "Invoice quarantine path", 500);
  if (quarantinePath !== `invoice-quarantine/${userId}/${invoiceId}/upload`) {
    throw new HttpsError("invalid-argument", "Invoice quarantine path is invalid");
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
    quarantinePath,
    originalFileName,
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
  current.notes === payload.notes;

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

const normalizeInvitationEmail = (value: unknown): string => {
  if (typeof value !== "string") return "";
  const email = value.trim().toLowerCase();
  if (
    !email
    || email.length > 254
    || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  ) {
    return "";
  }
  return email;
};

const hashInvitationEmail = (email: string, salt: string): string =>
  createHash("sha256").update(`${salt}:${email}`).digest("hex");

const hashInvitationTargetKey = (email: string): string =>
  createHash("sha256").update(`invitation-target-v1:${email}`).digest("hex");

const hashInvitationEnrollmentId = (enrollmentId: string): string =>
  createHash("sha256").update(`invitation-enrollment-v1:${enrollmentId}`).digest("hex");

const normalizeInvitationRequestKey = (value: unknown): string => {
  if (typeof value !== "string") return "";
  const requestKey = value.trim().toLowerCase();
  return /^[a-f0-9]{64}$/.test(requestKey) ? requestKey : "";
};

const hashInvitationRequestKey = (
  actorId: string,
  targetLockId: string,
  requestKey: string,
): string => createHash("sha256")
  .update(`invitation-request-v1:${actorId}:${targetLockId}:${requestKey}`)
  .digest("hex");

interface EncryptedInvitationCode {
  encryptedCode: string;
  codeEncryptionIv: string;
  codeEncryptionTag: string;
}

const invitationEncryptionKey = (requestKey: string) => createHash("sha256")
  .update(`invitation-code-encryption-v1:${requestKey}`)
  .digest();

const encryptInvitationCode = (
  code: string,
  requestKey: string,
): EncryptedInvitationCode => {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", invitationEncryptionKey(requestKey), iv);
  const encrypted = Buffer.concat([cipher.update(code, "utf8"), cipher.final()]);
  return {
    encryptedCode: encrypted.toString("base64url"),
    codeEncryptionIv: iv.toString("base64url"),
    codeEncryptionTag: cipher.getAuthTag().toString("base64url"),
  };
};

const decryptInvitationCode = (
  encrypted: EncryptedInvitationCode,
  requestKey: string,
): string => {
  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      invitationEncryptionKey(requestKey),
      Buffer.from(encrypted.codeEncryptionIv, "base64url"),
    );
    decipher.setAuthTag(Buffer.from(encrypted.codeEncryptionTag, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(encrypted.encryptedCode, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    return "";
  }
};

const isEncryptedInvitationCode = (value: Record<string, unknown>): boolean =>
  typeof value.encryptedCode === "string"
  && /^[A-Za-z0-9_-]{16}$/.test(value.encryptedCode)
  && typeof value.codeEncryptionIv === "string"
  && /^[A-Za-z0-9_-]{16}$/.test(value.codeEncryptionIv)
  && typeof value.codeEncryptionTag === "string"
  && /^[A-Za-z0-9_-]{22}$/.test(value.codeEncryptionTag);

const createInvitationCode = (): string =>
  randomBytes(INVITATION_CODE_LENGTH / 2).toString("hex").toUpperCase();

const createInvitationPlaceholderPassword = (): string =>
  `${randomBytes(48).toString("base64url")}Aa1!`;

const getAuthErrorCode = (error: unknown): string => (
  typeof error === "object"
  && error !== null
  && "code" in error
  && typeof error.code === "string"
    ? error.code
    : ""
);

const getInvitationEnrollmentId = (user: UserRecord): string => {
  const enrollmentId = user.customClaims?.invitationEnrollmentId;
  return typeof enrollmentId === "string" && /^[a-f0-9]{32}$/.test(enrollmentId)
    ? enrollmentId
    : "";
};

const getAuthorizationGrantId = (user: UserRecord): string => {
  const grantId = user.customClaims?.authorizationGrantId;
  return typeof grantId === "string" && /^[a-f0-9]{32}$/.test(grantId)
    ? grantId
    : "";
};

const authorizationGrantMatches = (
  data: Record<string, unknown>,
  role: AppRole,
  grantId: string,
): boolean => Object.keys(data).sort().join(",") === "active,grantId,role,updatedAt"
  && data.active === true
  && data.role === role
  && data.grantId === grantId
  && data.updatedAt instanceof Timestamp;

const requireCurrentAuthorizationGrant = async (
  userId: string,
  role: AppRole,
  grantId: string,
): Promise<void> => {
  if (!grantId) {
    throw new HttpsError("permission-denied", "A current authorized session is required");
  }
  const snapshot = await getFirestore().collection("authorizationGrants").doc(userId).get();
  if (!snapshot.exists || !authorizationGrantMatches(snapshot.data() ?? {}, role, grantId)) {
    throw new HttpsError("permission-denied", "A current authorized session is required");
  }
};

const requireEligibleInvitationTarget = (user: UserRecord): string => {
  const enrollmentId = getInvitationEnrollmentId(user);
  if (
    user.disabled
    || user.customClaims?.role !== undefined
    || !enrollmentId
  ) {
    throw new HttpsError(
      "failed-precondition",
      "The target account is not eligible for self-service invitation enrollment",
    );
  }
  return enrollmentId;
};

const getOrCreateInvitationTarget = async (
  targetEmail: string,
): Promise<{ user: UserRecord; enrollmentId: string }> => {
  try {
    const existing = await getAuth().getUserByEmail(targetEmail);
    return {
      user: existing,
      enrollmentId: requireEligibleInvitationTarget(existing),
    };
  } catch (error) {
    if (error instanceof HttpsError) throw error;
    if (getAuthErrorCode(error) !== "auth/user-not-found") {
      throw new HttpsError("internal", "Unable to validate the target account");
    }
  }

  const enrollmentId = randomBytes(INVITATION_ENROLLMENT_ID_BYTES).toString("hex");
  let createdUser: UserRecord;
  try {
    createdUser = await getAuth().createUser({
      email: targetEmail,
      emailVerified: false,
      disabled: false,
      password: createInvitationPlaceholderPassword(),
    });
  } catch (error) {
    if (getAuthErrorCode(error) !== "auth/email-already-exists") {
      throw new HttpsError("internal", "Unable to prepare the target account");
    }
    const racedUser = await getAuth().getUserByEmail(targetEmail).catch(() => null);
    if (!racedUser) {
      throw new HttpsError("internal", "Unable to validate the target account");
    }
    return {
      user: racedUser,
      enrollmentId: requireEligibleInvitationTarget(racedUser),
    };
  }

  try {
    await getAuth().setCustomUserClaims(createdUser.uid, {
      invitationEnrollmentId: enrollmentId,
    });
    const preparedUser = await getAuth().getUser(createdUser.uid);
    if (getInvitationEnrollmentId(preparedUser) !== enrollmentId) {
      throw new Error("Invitation enrollment marker did not persist");
    }
    return { user: preparedUser, enrollmentId };
  } catch {
    await getAuth().deleteUser(createdUser.uid).catch(() => undefined);
    throw new HttpsError("internal", "Unable to prepare the target account");
  }
};

const invalidInvitation = () => ({
  valid: false,
  role: null,
  expiresAt: null,
  errorMessage: "Invitation code is invalid or expired",
});

const invalidInvitationError = () =>
  new HttpsError("failed-precondition", "Invitation code is invalid or expired");

const getDirectInvitationActivation = async (
  code: string,
  targetEmail: string,
): Promise<{ targetUid: string; role: AppRole }> => {
  const firestore = getFirestore();
  const codeHash = hashInvitationCode(code);
  const invitations = await firestore
    .collection("invitations")
    .where("codeHash", "==", codeHash)
    .limit(2)
    .get();
  if (invitations.size !== 1) throw invalidInvitationError();

  const invitationReference = invitations.docs[0].ref;
  const invitationSnapshot = await invitationReference.get();
  const data = invitationSnapshot.data() ?? {};
  const targetLockId = hashInvitationTargetKey(targetEmail);
  const targetReference = firestore.collection("invitationTargets").doc(targetLockId);
  const targetSnapshot = await targetReference.get();
  const target = targetSnapshot.data() ?? {};
  const expiresAt = data.expiresAt instanceof Timestamp ? data.expiresAt.toMillis() : 0;
  const targetExpiresAt = target.expiresAt instanceof Timestamp
    ? target.expiresAt.toMillis()
    : 0;
  const targetEmailSalt = typeof data.targetEmailSalt === "string" ? data.targetEmailSalt : "";
  const targetEmailHash = targetEmailSalt
    ? hashInvitationEmail(targetEmail, targetEmailSalt)
    : "";

  if (
    data.schemaVersion !== INVITATION_SCHEMA_VERSION
    || data.codeHash !== codeHash
    || !/^[a-f0-9]{32}$/.test(targetEmailSalt)
    || data.targetEmailHash !== targetEmailHash
    || data.targetLockId !== targetLockId
    || typeof data.targetUid !== "string"
    || !data.targetUid
    || typeof data.targetEnrollmentHash !== "string"
    || !/^[a-f0-9]{64}$/.test(data.targetEnrollmentHash)
    || typeof data.requestKeyHash !== "string"
    || !/^[a-f0-9]{64}$/.test(data.requestKeyHash)
    || !Number.isSafeInteger(data.generation)
    || Number(data.generation) <= 0
    || !isEncryptedInvitationCode(data)
    || !isAppRole(data.role)
    || data.status !== "pending"
    || data.claimAssignmentState !== "not_started"
    || expiresAt <= Date.now()
    || !targetSnapshot.exists
    || target.invitationId !== invitationReference.id
    || target.requestKeyHash !== data.requestKeyHash
    || target.generation !== data.generation
    || target.status !== "pending"
    || targetExpiresAt !== expiresAt
  ) {
    throw invalidInvitationError();
  }

  let targetUser: UserRecord;
  try {
    targetUser = await getAuth().getUser(data.targetUid);
  } catch {
    throw invalidInvitationError();
  }
  const enrollmentId = getInvitationEnrollmentId(targetUser);
  if (
    targetUser.disabled
    || normalizeInvitationEmail(targetUser.email) !== targetEmail
    || targetUser.customClaims?.role !== undefined
    || !enrollmentId
    || hashInvitationEnrollmentId(enrollmentId) !== data.targetEnrollmentHash
  ) {
    throw invalidInvitationError();
  }

  return { targetUid: data.targetUid, role: data.role };
};

const normalizeInvitationActivationPassword = (value: unknown): string => {
  if (
    typeof value !== "string"
    || value.length < 8
    || value.length > 72
    || !/[A-Z]/.test(value)
    || !/[a-z]/.test(value)
    || !/[0-9]/.test(value)
  ) {
    throw new HttpsError("invalid-argument", "Password does not meet the minimum requirements");
  }
  return value;
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

const optionalText = (
  value: unknown,
  label: string,
  maximumLength: number,
): string | null => {
  if (value == null || value === "") return null;
  return requireText(value, label, maximumLength);
};

const getAssignedProjectPayload = (value: unknown): AssignedProjectPayload => {
  if (!isRecord(value)) {
    throw new HttpsError("invalid-argument", "Project details are required");
  }

  const projectId = requireText(value.projectId, "Project id", 128);
  if (!/^[A-Za-z0-9_-]{10,128}$/.test(projectId)) {
    throw new HttpsError("invalid-argument", "Project id is invalid");
  }

  const builderId = requireText(value.builderId, "Builder id", 128);
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(builderId)) {
    throw new HttpsError("invalid-argument", "Builder id is invalid");
  }

  return {
    projectId,
    builderId,
    name: requireText(value.name, "Project name", 160),
    description: optionalText(value.description, "Project description", 2_000),
    clientName: requireText(value.clientName, "Client name", 160),
    address: optionalText(value.address, "Project address", 500),
  };
};

const assignedProjectMatches = (
  current: Record<string, unknown>,
  payload: AssignedProjectPayload,
  managerId: string,
): boolean =>
  current.builderId === payload.builderId
  && current.ownerId === payload.builderId
  && current.createdBy === managerId
  && current.name === payload.name
  && current.description === payload.description
  && current.clientName === payload.clientName
  && current.address === payload.address
  && current.status === "active";

const wait = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

type RateLimitOperation =
  | "createManagerInvitation"
  | "validateInvitationCodeRequester"
  | "validateInvitationCodeGlobal"
  | "activateInvitation"
  | "consumeInvitation"
  | "listAssignableBuilders"
  | "createAssignedProject"
  | "extractJobsFromExcel"
  | "submitInvoice"
  | "reviewInvoice";

const RATE_LIMITS: Record<RateLimitOperation, { maxRequests: number; windowMs: number }> = {
  createManagerInvitation: { maxRequests: 10, windowMs: 60 * 1000 },
  validateInvitationCodeRequester: { maxRequests: 30, windowMs: 60 * 1000 },
  validateInvitationCodeGlobal: { maxRequests: 300, windowMs: 60 * 1000 },
  activateInvitation: { maxRequests: 5, windowMs: 15 * 60 * 1000 },
  consumeInvitation: { maxRequests: 5, windowMs: 15 * 60 * 1000 },
  listAssignableBuilders: { maxRequests: 30, windowMs: 60 * 1000 },
  createAssignedProject: { maxRequests: 20, windowMs: 60 * 1000 },
  extractJobsFromExcel: { maxRequests: 5, windowMs: 60 * 60 * 1000 },
  submitInvoice: { maxRequests: 10, windowMs: 10 * 60 * 1000 },
  reviewInvoice: { maxRequests: 30, windowMs: 60 * 1000 },
};

const anonymizedRequesterId = (rawIp: string | undefined): string => {
  const normalizedIp = rawIp?.split(",", 1)[0]?.trim() || "unknown";
  return createHash("sha256").update(`invitation-requester:${normalizedIp}`).digest("hex");
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

const requireCurrentRole = async (
  userId: string,
  tokenRole: unknown,
  tokenAuthorizationGrantId: unknown,
  tokenAuthTime: unknown,
  allowedRoles: readonly AppRole[],
) => {
  const user = await getUserWithRetry(userId);
  const currentRole = user.customClaims?.role;
  const currentAuthorizationGrantId = getAuthorizationGrantId(user);
  if (
    user.disabled
    || !isAppRole(currentRole)
    || !allowedRoles.includes(currentRole)
    || currentRole !== tokenRole
    || !currentAuthorizationGrantId
    || currentAuthorizationGrantId !== tokenAuthorizationGrantId
    || !hasCurrentAuthSession(user.tokensValidAfterTime, tokenAuthTime)
  ) {
    throw new HttpsError("permission-denied", "A current authorized session is required");
  }
  await requireCurrentAuthorizationGrant(
    userId,
    currentRole,
    currentAuthorizationGrantId,
  );
  return { user, role: currentRole };
};

const compensateInvitationAssignment = async (
  userId: string,
  invitationReference: DocumentReference,
  targetReference: DocumentReference,
): Promise<void> => {
  await getFirestore().runTransaction(async (transaction) => {
    const [invitationSnapshot, targetSnapshot] = await Promise.all([
      transaction.get(invitationReference),
      transaction.get(targetReference),
    ]);
    const invitation = invitationSnapshot.data() ?? {};
    const target = targetSnapshot.data() ?? {};
    if (
      invitationSnapshot.exists
      && targetSnapshot.exists
      && invitation.status === "used"
      && invitation.usedBy === userId
      && invitation.claimAssignmentState === "pending"
      && target.invitationId === invitationReference.id
      && target.status === "assigning"
    ) {
      transaction.update(invitationReference, {
        status: "pending" as InvitationStatus,
        claimAssignmentState: "not_started" as InvitationClaimAssignmentState,
        usedBy: null,
        usedAt: null,
      });
      transaction.update(targetReference, {
        status: "pending" as InvitationTargetStatus,
        updatedAt: Timestamp.now(),
      });
    }
  });
};

const failInvitationAssignment = async (
  userId: string,
  invitationReference: DocumentReference,
  targetReference: DocumentReference,
): Promise<void> => {
  await getFirestore().runTransaction(async (transaction) => {
    const [invitationSnapshot, targetSnapshot] = await Promise.all([
      transaction.get(invitationReference),
      transaction.get(targetReference),
    ]);
    const invitation = invitationSnapshot.data() ?? {};
    const target = targetSnapshot.data() ?? {};
    if (
      invitationSnapshot.exists
      && targetSnapshot.exists
      && invitation.status === "used"
      && invitation.usedBy === userId
      && invitation.claimAssignmentState === "pending"
      && target.invitationId === invitationReference.id
    ) {
      transaction.update(invitationReference, {
        claimAssignmentState: "failed" as InvitationClaimAssignmentState,
      });
      transaction.update(targetReference, {
        status: "failed" as InvitationTargetStatus,
        updatedAt: Timestamp.now(),
      });
    }
  });
};

const assignInvitationRole = async (
  userId: string,
  userEmail: string,
  role: AppRole,
  invitationReference: DocumentReference,
  targetReference: DocumentReference,
): Promise<void> => {
  const latestUser = await getUserWithRetry(userId);
  const latestEmail = normalizeInvitationEmail(latestUser.email);
  const latestRole = latestUser.customClaims?.role;
  if (
    latestUser.disabled
    || !latestUser.emailVerified
    || latestEmail !== userEmail
    || (latestRole !== undefined && latestRole !== role)
  ) {
    await failInvitationAssignment(userId, invitationReference, targetReference)
      .catch(() => console.error("Invitation assignment could not be failed closed", {
        operation: "consumeInvitation",
      }));
    throw new HttpsError("permission-denied", "The account is no longer eligible for this invitation");
  }

  const enrollmentId = getInvitationEnrollmentId(latestUser);
  let authorizationGrantId = getAuthorizationGrantId(latestUser);
  if (latestRole !== role || enrollmentId || !authorizationGrantId) {
    authorizationGrantId = randomBytes(AUTHORIZATION_GRANT_ID_BYTES).toString("hex");
    try {
      const preservedClaims = { ...(latestUser.customClaims ?? {}) };
      delete preservedClaims.invitationEnrollmentId;
      await getAuth().setCustomUserClaims(userId, {
        ...preservedClaims,
        role,
        authorizationGrantId,
      });
    } catch {
      await compensateInvitationAssignment(userId, invitationReference, targetReference)
        .catch(() => console.error("Role assignment compensation failed", {
          operation: "consumeInvitation",
        }));
      throw new HttpsError("internal", "Unable to assign the account role; please retry");
    }
  }

  const assignedUser = await getUserWithRetry(userId);
  if (
    assignedUser.disabled
    || !assignedUser.emailVerified
    || normalizeInvitationEmail(assignedUser.email) !== userEmail
    || assignedUser.customClaims?.role !== role
    || getInvitationEnrollmentId(assignedUser)
    || getAuthorizationGrantId(assignedUser) !== authorizationGrantId
  ) {
    await failInvitationAssignment(userId, invitationReference, targetReference)
      .catch(() => console.error("Invitation assignment verification could not fail closed", {
        operation: "consumeInvitation",
      }));
    throw new HttpsError(
      "permission-denied",
      "The account role could not be verified after assignment",
    );
  }

  const authorizationGrantReference = getFirestore()
    .collection("authorizationGrants")
    .doc(userId);
  try {
    await getFirestore().runTransaction(async (transaction) => {
      const [invitationSnapshot, targetSnapshot, authorizationGrantSnapshot] = await Promise.all([
        transaction.get(invitationReference),
        transaction.get(targetReference),
        transaction.get(authorizationGrantReference),
      ]);
      const invitation = invitationSnapshot.data() ?? {};
      const target = targetSnapshot.data() ?? {};
      if (
        !invitationSnapshot.exists
        || !targetSnapshot.exists
        || invitation.status !== "used"
        || invitation.usedBy !== userId
        || target.invitationId !== invitationReference.id
      ) {
        throw new HttpsError("failed-precondition", "Invitation assignment state is inconsistent");
      }
      if (invitation.claimAssignmentState === "completed") {
        if (
          target.status !== "completed"
          || !authorizationGrantSnapshot.exists
          || !authorizationGrantMatches(
            authorizationGrantSnapshot.data() ?? {},
            role,
            authorizationGrantId,
          )
        ) {
          throw new HttpsError(
            "failed-precondition",
            "A completed invitation cannot restore a changed or revoked role",
          );
        }
        return;
      }
      if (invitation.claimAssignmentState !== "pending" || target.status !== "assigning") {
        throw new HttpsError("failed-precondition", "Invitation assignment is not recoverable");
      }
      const completedAt = Timestamp.now();
      transaction.create(authorizationGrantReference, {
        active: true,
        role,
        grantId: authorizationGrantId,
        updatedAt: completedAt,
      });
      transaction.update(invitationReference, {
        claimAssignmentState: "completed" as InvitationClaimAssignmentState,
        claimAssignedAt: completedAt,
      });
      transaction.update(targetReference, {
        status: "completed" as InvitationTargetStatus,
        updatedAt: completedAt,
      });
    });
  } catch {
    throw new HttpsError(
      "internal",
      "The role was assigned but confirmation is pending; retry the invitation",
    );
  }

  const confirmedGrant = await authorizationGrantReference.get().catch(() => null);
  if (
    !confirmedGrant?.exists
    || !authorizationGrantMatches(confirmedGrant.data() ?? {}, role, authorizationGrantId)
  ) {
    throw new HttpsError(
      "permission-denied",
      "The account authorization grant could not be verified after assignment",
    );
  }
};

export const createManagerInvitation = onCall(appCheckOptions, async (request) => {
  const tokenRole = request.auth?.token.role;
  if (!request.auth || !isManagementRole(tokenRole)) {
    throw new HttpsError("permission-denied", "Admin or manager role is required");
  }
  const actorId = request.auth.uid;

  if (!isRecord(request.data) || !isAppRole(request.data.role)) {
    throw new HttpsError("invalid-argument", "A valid invitation role is required");
  }
  const targetEmail = normalizeInvitationEmail(request.data.targetEmail);
  if (!targetEmail) {
    throw new HttpsError("invalid-argument", "A valid target email is required");
  }
  const requestKey = normalizeInvitationRequestKey(request.data.requestKey);
  if (!requestKey) {
    throw new HttpsError("invalid-argument", "A valid invitation request key is required");
  }

  const { role: actorRole } = await requireCurrentRole(
    actorId,
    tokenRole,
    request.auth.token.authorizationGrantId,
    request.auth.token.auth_time,
    ["admin", "manager"],
  );
  if (!isManagementRole(actorRole)) {
    throw new HttpsError("permission-denied", "Admin or manager role is required");
  }
  if (!canInviteRole(actorRole, request.data.role)) {
    throw new HttpsError(
      "permission-denied",
      "Admin enrollment is restricted to the controlled administrative runbook",
    );
  }
  if (
    request.data.role === "manager"
    && !hasRecentAuthentication(request.auth.token.auth_time)
  ) {
    throw new HttpsError(
      "failed-precondition",
      "Sign in again before creating a manager invitation",
    );
  }

  await enforceRateLimit(actorId, "createManagerInvitation");

  const targetLockId = hashInvitationTargetKey(targetEmail);
  const requestKeyHash = hashInvitationRequestKey(actorId, targetLockId, requestKey);
  const targetAccount = await getOrCreateInvitationTarget(targetEmail);
  const targetUid = targetAccount.user.uid;
  const targetEnrollmentHash = hashInvitationEnrollmentId(targetAccount.enrollmentId);

  const code = createInvitationCode();
  const encryptedCode = encryptInvitationCode(code, requestKey);
  const targetEmailSalt = randomBytes(INVITATION_EMAIL_SALT_BYTES).toString("hex");
  const expiresAt = Timestamp.fromMillis(Date.now() + INVITATION_TTL_MS);
  const createdAt = Timestamp.now();
  const firestore = getFirestore();
  const invitationReference = firestore.collection("invitations").doc();
  const targetReference = firestore.collection("invitationTargets").doc(targetLockId);
  const result = await firestore.runTransaction(async (transaction) => {
    const targetSnapshot = await transaction.get(targetReference);
    const activeTarget = targetSnapshot.data() ?? {};
    const activeUntil = activeTarget.expiresAt instanceof Timestamp
      ? activeTarget.expiresAt.toMillis()
      : 0;
    if (
      targetSnapshot.exists
      && (activeTarget.status === "pending" || activeTarget.status === "assigning")
      && activeUntil > Date.now()
    ) {
      if (
        activeTarget.requestKeyHash !== requestKeyHash
        || typeof activeTarget.invitationId !== "string"
      ) {
        throw new HttpsError("already-exists", "An active invitation already exists for this email");
      }
      const existingReference = firestore.collection("invitations").doc(activeTarget.invitationId);
      const existingSnapshot = await transaction.get(existingReference);
      const existing = existingSnapshot.data() ?? {};
      const existingExpiresAt = existing.expiresAt instanceof Timestamp
        ? existing.expiresAt
        : null;
      if (
        !existingSnapshot.exists
        || existing.schemaVersion !== INVITATION_SCHEMA_VERSION
        || existing.requestKeyHash !== requestKeyHash
        || existing.targetLockId !== targetLockId
        || existing.targetUid !== targetUid
        || existing.targetEnrollmentHash !== targetEnrollmentHash
        || existing.createdBy !== actorId
        || existing.createdByRole !== actorRole
        || existing.role !== request.data.role
        || existing.status !== "pending"
        || existing.claimAssignmentState !== "not_started"
        || typeof existing.codeHash !== "string"
        || !/^[a-f0-9]{64}$/.test(existing.codeHash)
        || !existingExpiresAt
        || existingExpiresAt.toMillis() !== activeUntil
        || !Number.isSafeInteger(existing.generation)
        || existing.generation !== activeTarget.generation
        || !isEncryptedInvitationCode(existing)
      ) {
        throw new HttpsError(
          "failed-precondition",
          "The active invitation cannot be recovered safely",
        );
      }
      return {
        encryptedCode: existing.encryptedCode as string,
        codeEncryptionIv: existing.codeEncryptionIv as string,
        codeEncryptionTag: existing.codeEncryptionTag as string,
        codeHash: existing.codeHash as string,
        expiresAt: existingExpiresAt,
      };
    }

    const previousGeneration = Number.isSafeInteger(activeTarget.generation)
      && Number(activeTarget.generation) >= 0
      ? Number(activeTarget.generation)
      : 0;
    const generation = previousGeneration + 1;

    transaction.create(invitationReference, {
      schemaVersion: INVITATION_SCHEMA_VERSION,
      codeHash: hashInvitationCode(code),
      ...encryptedCode,
      requestKeyHash,
      generation,
      targetEmailHash: hashInvitationEmail(targetEmail, targetEmailSalt),
      targetEmailSalt,
      targetLockId,
      targetUid,
      targetEnrollmentHash,
      role: request.data.role,
      status: "pending" as InvitationStatus,
      claimAssignmentState: "not_started" as InvitationClaimAssignmentState,
      createdBy: actorId,
      createdByRole: actorRole,
      createdAt,
      expiresAt,
      usedBy: null,
      usedAt: null,
      claimAssignedAt: null,
    });
    transaction.set(targetReference, {
      invitationId: invitationReference.id,
      requestKeyHash,
      generation,
      status: "pending" as InvitationTargetStatus,
      expiresAt,
      createdAt,
      updatedAt: createdAt,
    });
    return { ...encryptedCode, codeHash: hashInvitationCode(code), expiresAt };
  });

  const recoveredCode = decryptInvitationCode(result, requestKey);
  if (
    !normalizeInvitationCode(recoveredCode)
    || !/^[a-f0-9]{64}$/.test(result.codeHash)
    || hashInvitationCode(recoveredCode) !== result.codeHash
  ) {
    throw new HttpsError("internal", "The invitation code could not be recovered safely");
  }
  return {
    code: recoveredCode,
    role: request.data.role,
    expiresAt: result.expiresAt.toDate().toISOString(),
  };
});

export const validateInvitationCode = onCall(
  { ...appCheckOptions, timeoutSeconds: 10, memory: "256MiB", maxInstances: 2 },
  async (request) => {
    // This endpoint must remain public so a new user can validate an invitation
    // before authenticating. A requester-partitioned quota limits abuse without
    // storing the source IP, while an emergency global ceiling bounds aggregate
    // Firestore work until App Check enforcement is enabled after observation.
    await Promise.all([
      enforceRateLimit(
        anonymizedRequesterId(request.rawRequest.ip),
        "validateInvitationCodeRequester",
      ),
      enforceRateLimit("public-emergency-ceiling", "validateInvitationCodeGlobal"),
    ]);

    const payload: Record<string, unknown> = isRecord(request.data)
      ? request.data
      : { code: request.data };
    const code = normalizeInvitationCode(payload.code);
    if (!code) return invalidInvitation();
    const requestedTargetEmail = payload.targetEmail === undefined
      ? null
      : normalizeInvitationEmail(payload.targetEmail);
    if (payload.targetEmail !== undefined && !requestedTargetEmail) return invalidInvitation();

    const snapshot = await getFirestore()
      .collection("invitations")
      .where("codeHash", "==", hashInvitationCode(code))
      .limit(2)
      .get();
    if (snapshot.size !== 1) return invalidInvitation();

    const invitation = snapshot.docs[0];
    const data = invitation.data();
    const expiresAt = data.expiresAt instanceof Timestamp ? data.expiresAt.toMillis() : 0;
    const targetEmailSalt = typeof data.targetEmailSalt === "string" ? data.targetEmailSalt : "";
    const targetLockId = typeof data.targetLockId === "string" ? data.targetLockId : "";
    const requestedTargetHash = requestedTargetEmail && targetEmailSalt
      ? hashInvitationEmail(requestedTargetEmail, targetEmailSalt)
      : null;
    const targetSnapshot = /^[a-f0-9]{64}$/.test(targetLockId)
      ? await getFirestore().collection("invitationTargets").doc(targetLockId).get()
      : null;
    const target = targetSnapshot?.data() ?? {};
    const targetExpiresAt = target.expiresAt instanceof Timestamp
      ? target.expiresAt.toMillis()
      : 0;
    if (
      data.schemaVersion !== INVITATION_SCHEMA_VERSION
      || !/^[a-f0-9]{32}$/.test(targetEmailSalt)
      || typeof data.targetEmailHash !== "string"
      || !/^[a-f0-9]{64}$/.test(data.targetEmailHash)
      || !/^[a-f0-9]{64}$/.test(targetLockId)
      || typeof data.targetUid !== "string"
      || !data.targetUid
      || typeof data.targetEnrollmentHash !== "string"
      || !/^[a-f0-9]{64}$/.test(data.targetEnrollmentHash)
      || typeof data.requestKeyHash !== "string"
      || !/^[a-f0-9]{64}$/.test(data.requestKeyHash)
      || !Number.isSafeInteger(data.generation)
      || Number(data.generation) <= 0
      || !isEncryptedInvitationCode(data)
      || (requestedTargetHash !== null && requestedTargetHash !== data.targetEmailHash)
      || !isAppRole(data.role)
      || !isInvitationStatus(data.status)
      || !isInvitationClaimAssignmentState(data.claimAssignmentState)
      || data.status !== "pending"
      || data.claimAssignmentState !== "not_started"
      || expiresAt <= Date.now()
      || !targetSnapshot?.exists
      || target.invitationId !== invitation.id
      || target.requestKeyHash !== data.requestKeyHash
      || target.generation !== data.generation
      || !isInvitationTargetStatus(target.status)
      || target.status !== "pending"
      || targetExpiresAt !== expiresAt
    ) {
      return invalidInvitation();
    }

    return {
      valid: true,
      role: data.role,
      expiresAt: new Date(expiresAt).toISOString(),
      errorMessage: null,
    };
  },
);

export const activateInvitation = onCall(appCheckOptions, async (request) => {
  await enforceRateLimit(
    anonymizedRequesterId(request.rawRequest.ip),
    "activateInvitation",
  );
  if (!isRecord(request.data)) {
    throw new HttpsError("invalid-argument", "Invitation activation details are required");
  }

  const code = normalizeInvitationCode(request.data.code);
  const targetEmail = normalizeInvitationEmail(request.data.targetEmail);
  const fullName = requireText(request.data.fullName, "Full name", 100);
  const password = normalizeInvitationActivationPassword(request.data.password);
  if (!code || !targetEmail) {
    throw invalidInvitationError();
  }

  const activation = await getDirectInvitationActivation(code, targetEmail);
  await enforceRateLimit(activation.targetUid, "activateInvitation");
  try {
    await getAuth().updateUser(activation.targetUid, {
      password,
      displayName: fullName,
      emailVerified: true,
    });
  } catch {
    throw new HttpsError("internal", "Unable to activate the invited account");
  }

  return { activated: true, role: activation.role };
});

export const consumeInvitation = onCall(appCheckOptions, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication is required");
  }
  const code = normalizeInvitationCode(isRecord(request.data) ? request.data.code : null);
  if (!code) throw new HttpsError("invalid-argument", "A valid invitation code is required");

  const firestore = getFirestore();
  const userId = request.auth.uid;
  await enforceRateLimit(userId, "consumeInvitation");
  const user = await getUserWithRetry(userId);
  const userEmail = normalizeInvitationEmail(user.email);
  if (
    user.disabled
    || !userEmail
    || !hasCurrentAuthSession(user.tokensValidAfterTime, request.auth.token.auth_time)
  ) {
    throw new HttpsError("permission-denied", "An active account with a valid email is required");
  }
  if (!user.emailVerified) {
    throw new HttpsError(
      "failed-precondition",
      "Verify the account email before accepting the invitation",
      { reason: "email-not-verified" },
    );
  }
  const currentRole = user.customClaims?.role;
  const enrollmentId = getInvitationEnrollmentId(user);
  const currentEnrollmentHash = enrollmentId
    ? hashInvitationEnrollmentId(enrollmentId)
    : "";
  const codeHash = hashInvitationCode(code);
  const invitations = await firestore
    .collection("invitations")
    .where("codeHash", "==", codeHash)
    .limit(2)
    .get();
  if (invitations.size !== 1) throw invalidInvitationError();
  const invitationRef = invitations.docs[0].ref;
  const targetLockId = hashInvitationTargetKey(userEmail);
  const targetRef = firestore.collection("invitationTargets").doc(targetLockId);

  const result = await firestore.runTransaction(async (transaction) => {
    const [snapshot, targetSnapshot] = await Promise.all([
      transaction.get(invitationRef),
      transaction.get(targetRef),
    ]);
    if (!snapshot.exists || !targetSnapshot.exists) throw invalidInvitationError();
    const data = snapshot.data() ?? {};
    const target = targetSnapshot.data() ?? {};
    const expiresAt = data.expiresAt instanceof Timestamp ? data.expiresAt.toMillis() : 0;
    const targetExpiresAt = target.expiresAt instanceof Timestamp
      ? target.expiresAt.toMillis()
      : 0;
    const targetEmailSalt = typeof data.targetEmailSalt === "string" ? data.targetEmailSalt : "";
    const targetEmailHash = targetEmailSalt
      ? hashInvitationEmail(userEmail, targetEmailSalt)
      : "";
    if (
      data.schemaVersion !== INVITATION_SCHEMA_VERSION
      || data.codeHash !== codeHash
      || !/^[a-f0-9]{32}$/.test(targetEmailSalt)
      || data.targetEmailHash !== targetEmailHash
      || data.targetLockId !== targetLockId
      || data.targetUid !== userId
      || typeof data.targetEnrollmentHash !== "string"
      || !/^[a-f0-9]{64}$/.test(data.targetEnrollmentHash)
      || typeof data.requestKeyHash !== "string"
      || !/^[a-f0-9]{64}$/.test(data.requestKeyHash)
      || !Number.isSafeInteger(data.generation)
      || Number(data.generation) <= 0
      || !isEncryptedInvitationCode(data)
      || !isAppRole(data.role)
      || !isInvitationStatus(data.status)
      || !isInvitationClaimAssignmentState(data.claimAssignmentState)
      || target.invitationId !== invitationRef.id
      || target.requestKeyHash !== data.requestKeyHash
      || target.generation !== data.generation
      || !isInvitationTargetStatus(target.status)
      || expiresAt <= 0
      || targetExpiresAt !== expiresAt
    ) {
      throw invalidInvitationError();
    }

    if (data.status === "used") {
      if (data.usedBy !== userId) throw invalidInvitationError();
      if (data.claimAssignmentState === "completed") {
        if (target.status !== "completed") {
          throw new HttpsError(
            "failed-precondition",
            "Invitation assignment state is inconsistent",
          );
        }
        return { role: data.role, shouldAssign: false, verifyCompleted: true };
      }
      if (data.claimAssignmentState === "failed") {
        throw new HttpsError(
          "failed-precondition",
          "Invitation assignment requires administrator recovery",
        );
      }
      if (data.claimAssignmentState !== "pending" || target.status !== "assigning") {
        throw invalidInvitationError();
      }
      if (currentRole !== undefined && currentRole !== data.role) {
        throw new HttpsError(
          "permission-denied",
          "The invitation role conflicts with the current account",
        );
      }
      const originalEnrollmentMatches = Boolean(enrollmentId)
        && data.targetEnrollmentHash === currentEnrollmentHash;
      const partialAssignmentMatches = currentRole === data.role && !enrollmentId;
      if (!originalEnrollmentMatches && !partialAssignmentMatches) {
        throw invalidInvitationError();
      }
      const usedAt = data.usedAt instanceof Timestamp ? data.usedAt.toMillis() : 0;
      if (usedAt <= 0 || Date.now() - usedAt > INVITATION_ASSIGNMENT_RECOVERY_MS) {
        throw new HttpsError(
          "failed-precondition",
          "Invitation assignment recovery window has closed",
        );
      }
      return { role: data.role, shouldAssign: true, verifyCompleted: false };
    }

    if (
      data.claimAssignmentState !== "not_started"
      || target.status !== "pending"
      || expiresAt <= Date.now()
    ) {
      throw invalidInvitationError();
    }
    if (currentRole !== undefined && currentRole !== data.role) {
      throw new HttpsError("permission-denied", "The invitation role conflicts with the current account");
    }

    const originalEnrollmentMatches = Boolean(enrollmentId)
      && data.targetEnrollmentHash === currentEnrollmentHash;
    const compensatedAssignmentMatches = currentRole === data.role && !enrollmentId;
    if (!originalEnrollmentMatches && !compensatedAssignmentMatches) {
      throw invalidInvitationError();
    }
    const now = Timestamp.now();
    transaction.update(invitationRef, {
      status: "used" as InvitationStatus,
      claimAssignmentState: "pending" as InvitationClaimAssignmentState,
      usedBy: userId,
      usedAt: now,
      claimAssignedAt: null,
    });
    transaction.update(targetRef, {
      status: "assigning" as InvitationTargetStatus,
      updatedAt: now,
    });
    return {
      role: data.role,
      shouldAssign: true,
      verifyCompleted: false,
    };
  });

  if (result.verifyCompleted) {
    const completedUser = await getUserWithRetry(userId);
    const completedGrantId = getAuthorizationGrantId(completedUser);
    if (
      completedUser.disabled
      || !completedUser.emailVerified
      || completedUser.customClaims?.role !== result.role
      || !completedGrantId
    ) {
      throw new HttpsError(
        "permission-denied",
        "A completed invitation cannot restore a changed or revoked role",
      );
    }
    await requireCurrentAuthorizationGrant(userId, result.role, completedGrantId);
  }
  if (result.shouldAssign) {
    await assignInvitationRole(
      userId,
      userEmail,
      result.role,
      invitationRef,
      targetRef,
    );
  }
  return { role: result.role };
});

export const listAssignableBuilders = onCall(
  { ...appCheckOptions, timeoutSeconds: 15, memory: "256MiB", maxInstances: 10 },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Authentication is required");
    }
    await requireCurrentRole(
      request.auth.uid,
      request.auth.token.role,
      request.auth.token.authorizationGrantId,
      request.auth.token.auth_time,
      ["admin", "manager"],
    );

    await enforceRateLimit(request.auth.uid, "listAssignableBuilders");
    const page = await getAuth().listUsers(1_000);
    const builders = page.users
      .filter((user) => !user.disabled && user.customClaims?.role === "builder")
      .map((user) => ({
        id: user.uid,
        email: user.email ?? null,
        displayName: user.displayName?.trim() || null,
      }))
      .sort((left, right) =>
        (left.displayName ?? left.email ?? left.id).localeCompare(
          right.displayName ?? right.email ?? right.id,
        ));

    return { builders };
  },
);

export const createAssignedProject = onCall(
  { ...appCheckOptions, timeoutSeconds: 15, memory: "256MiB", maxInstances: 10 },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Authentication is required");
    }
    await requireCurrentRole(
      request.auth.uid,
      request.auth.token.role,
      request.auth.token.authorizationGrantId,
      request.auth.token.auth_time,
      ["admin", "manager"],
    );

    const payload = getAssignedProjectPayload(request.data);
    const managerId = request.auth.uid;
    await enforceRateLimit(managerId, "createAssignedProject");

    let builder;
    try {
      builder = await getAuth().getUser(payload.builderId);
    } catch (error) {
      if (
        typeof error === "object"
        && error !== null
        && "code" in error
        && error.code === "auth/user-not-found"
      ) {
        throw new HttpsError("failed-precondition", "The selected builder is not provisioned");
      }
      throw new HttpsError("internal", "Unable to validate the selected builder");
    }

    if (builder.disabled || builder.customClaims?.role !== "builder") {
      throw new HttpsError("failed-precondition", "The selected builder is not active or authorized");
    }

    const firestore = getFirestore();
    const projectReference = firestore.collection("projects").doc(payload.projectId);
    await firestore.runTransaction(async (transaction) => {
      const existing = await transaction.get(projectReference);
      if (existing.exists) {
        if (!assignedProjectMatches(existing.data() ?? {}, payload, managerId)) {
          throw new HttpsError("already-exists", "Project id is already in use");
        }
        return;
      }

      transaction.create(projectReference, {
        builderId: payload.builderId,
        // Compatibility alias for the current Rules contract. Rules must require
        // ownerId == builderId until all legacy documents have been migrated.
        ownerId: payload.builderId,
        createdBy: managerId,
        name: payload.name,
        description: payload.description,
        clientName: payload.clientName,
        address: payload.address,
        status: "active",
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
      });
    });

    return { projectId: payload.projectId };
  },
);

export const submitInvoice = onCall(
  { ...appCheckOptions, timeoutSeconds: 60, memory: "512MiB", maxInstances: 5 },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Authentication is required");
    }
    const { user: builder } = await requireCurrentRole(
      request.auth.uid,
      request.auth.token.role,
      request.auth.token.authorizationGrantId,
      request.auth.token.auth_time,
      ["builder"],
    );

    const userId = request.auth.uid;
    await enforceRateLimit(userId, "submitInvoice");
    const uploadedByName = builder.displayName?.trim() || null;
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

    const projectReference = firestore.collection("projects").doc(payload.projectId);
    const projectBeforeProcessing = await projectReference.get();
    const initialProjectData = projectBeforeProcessing.data() ?? {};
    if (
      !projectBeforeProcessing.exists
      || initialProjectData.builderId !== userId
      || initialProjectData.ownerId !== userId
    ) {
      throw new HttpsError("permission-denied", "The selected project does not belong to this builder");
    }

    const bucket = getInvoiceStorageBucket();
    const quarantineFile = bucket.file(payload.quarantinePath);
    let quarantineMetadata;
    let contents: Buffer;
    try {
      [quarantineMetadata] = await quarantineFile.getMetadata();
      [contents] = await quarantineFile.download();
    } catch {
      throw new HttpsError("failed-precondition", "Invoice file was not found");
    }
    const quarantinedSize = Number(quarantineMetadata.size);
    const claimedContentType = String(quarantineMetadata.contentType ?? "").toLowerCase();
    const quarantineGeneration = String(quarantineMetadata.generation ?? "");
    if (
      !Number.isSafeInteger(quarantinedSize)
      || quarantinedSize <= 0
      || quarantinedSize >= MAX_INVOICE_FILE_BYTES
      || contents.length !== quarantinedSize
      || !quarantineGeneration
    ) {
      throw new HttpsError("failed-precondition", "Invoice file metadata is invalid");
    }

    let sanitized;
    try {
      sanitized = await sanitizeInvoiceFile(
        contents,
        claimedContentType,
        payload.originalFileName,
      );
    } catch {
      throw new HttpsError("invalid-argument", "Invoice file content is invalid");
    }

    const filePath = `invoices/${userId}/${payload.invoiceId}/${sanitized.fileName}`;
    const finalFile = bucket.file(filePath);
    let promotedByThisRequest = false;
    try {
      await finalFile.save(sanitized.bytes, {
        resumable: false,
        contentType: sanitized.contentType,
        metadata: {
          cacheControl: "private, max-age=0, no-store",
          metadata: { sourceGeneration: quarantineGeneration },
        },
        preconditionOpts: { ifGenerationMatch: 0 },
      });
      promotedByThisRequest = true;
    } catch {
      let existingFinalMetadata;
      try {
        [existingFinalMetadata] = await finalFile.getMetadata();
      } catch {
        throw new HttpsError("internal", "Invoice file could not be promoted");
      }
      if (existingFinalMetadata.metadata?.sourceGeneration !== quarantineGeneration) {
        throw new HttpsError("already-exists", "Invoice file id is already in use");
      }
    }

    let finalMetadata;
    try {
      [finalMetadata] = await finalFile.getMetadata();
    } catch {
      if (promotedByThisRequest) await finalFile.delete().catch(() => undefined);
      throw new HttpsError("internal", "Promoted invoice file could not be verified");
    }
    const fileSize = Number(finalMetadata.size);
    const fileGeneration = String(finalMetadata.generation ?? "");
    if (
      !Number.isSafeInteger(fileSize)
      || fileSize !== sanitized.bytes.length
      || finalMetadata.contentType !== sanitized.contentType
      || !fileGeneration
    ) {
      if (promotedByThisRequest) await finalFile.delete().catch(() => undefined);
      throw new HttpsError("internal", "Promoted invoice file metadata is invalid");
    }

    let status;
    try {
      status = await firestore.runTransaction(async (transaction) => {
        const [invoiceSnapshot, projectSnapshot] = await Promise.all([
          transaction.get(invoiceRef),
          transaction.get(projectReference),
        ]);
        const projectData = projectSnapshot.data() ?? {};
        if (
          !projectSnapshot.exists
          || projectData.builderId !== userId
          || projectData.ownerId !== userId
        ) {
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
          projectName: String(projectData.name ?? ""),
          invoiceNumber: payload.invoiceNumber,
          supplierName: payload.supplierName,
          invoiceDate: payload.invoiceDate,
          totalAmountMinor: payload.totalAmountMinor,
          currency: payload.currency,
          notes: payload.notes,
          filePath,
          fileName: sanitized.fileName,
          contentType: sanitized.contentType,
          fileSize,
          fileGeneration,
          fileMd5Hash: finalMetadata.md5Hash ?? null,
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
    } catch (error) {
      if (promotedByThisRequest) await finalFile.delete().catch(() => undefined);
      throw error;
    }

    await quarantineFile.delete({ ifGenerationMatch: Number(quarantineGeneration) }).catch(() => {
      console.warn("Invoice quarantine cleanup deferred", { operation: "submitInvoice" });
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
  { ...appCheckOptions, timeoutSeconds: 60, memory: "256MiB", maxInstances: 5 },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Authentication is required");
    }
    await requireCurrentRole(
      request.auth.uid,
      request.auth.token.role,
      request.auth.token.authorizationGrantId,
      request.auth.token.auth_time,
      ["admin", "manager"],
    );

    const managerId = request.auth.uid;
    await enforceRateLimit(managerId, "extractJobsFromExcel");
    const payload = getJobImportPayload(request.data, managerId);
    const firestore = getFirestore();
    const projectSnapshot = await firestore.collection("projects").doc(payload.projectId).get();
    if (!projectSnapshot.exists) {
      throw new HttpsError("not-found", "Project was not found");
    }
    const projectData = projectSnapshot.data() ?? {};
    const builderId = typeof projectData.builderId === "string"
      ? projectData.builderId.trim()
      : "";
    const ownerId = typeof projectData.ownerId === "string"
      ? projectData.ownerId.trim()
      : "";
    if (!builderId || ownerId !== builderId) {
      throw new HttpsError("failed-precondition", "The project builder assignment is inconsistent");
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
  { ...appCheckOptions, timeoutSeconds: 15, memory: "256MiB", maxInstances: 10 },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Authentication is required");
    }
    await requireCurrentRole(
      request.auth.uid,
      request.auth.token.role,
      request.auth.token.authorizationGrantId,
      request.auth.token.auth_time,
      ["admin", "manager"],
    );
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
    const controlRecordCutoff = now - RATE_LIMIT_RETENTION_MS;
    const staleInvitationSnapshot = await firestore
      .collection("invitations")
      .where("expiresAt", "<=", Timestamp.fromMillis(controlRecordCutoff))
      .limit(CLEANUP_BATCH_LIMIT)
      .get();
    const staleRateLimitSnapshot = await firestore
      .collection("functionRateLimits")
      .where("updatedAt", "<=", Timestamp.fromMillis(controlRecordCutoff))
      .limit(CLEANUP_BATCH_LIMIT)
      .get();

    let expiredInvitations = 0;
    let expiredInvitationTargets = 0;
    for (let offset = 0; offset < staleInvitationSnapshot.docs.length; offset += 10) {
      const outcomes = await Promise.all(
        staleInvitationSnapshot.docs.slice(offset, offset + 10).map((snapshot) =>
          firestore.runTransaction(async (transaction) => {
            const current = await transaction.get(snapshot.ref);
            const data = current.data() ?? {};
            const expiresAt = data.expiresAt instanceof Timestamp ? data.expiresAt.toMillis() : 0;
            if (!current.exists || expiresAt <= 0 || expiresAt > controlRecordCutoff) {
              return { invitation: 0, target: 0 };
            }
            const targetLockId = typeof data.targetLockId === "string" ? data.targetLockId : "";
            const targetRef = /^[a-f0-9]{64}$/.test(targetLockId)
              ? firestore.collection("invitationTargets").doc(targetLockId)
              : null;
            const target = targetRef ? await transaction.get(targetRef) : null;
            const targetData = target?.data() ?? {};
            const targetExpiresAt = targetData.expiresAt instanceof Timestamp
              ? targetData.expiresAt.toMillis()
              : 0;
            transaction.delete(snapshot.ref);
            if (
              targetRef
              && target?.exists
              && targetData.invitationId === snapshot.id
              && targetExpiresAt > 0
              && targetExpiresAt <= controlRecordCutoff
            ) {
              transaction.delete(targetRef);
              return { invitation: 1, target: 1 };
            }
            return { invitation: 1, target: 0 };
          }),
        ),
      );
      expiredInvitations += outcomes.reduce((total, outcome) => total + outcome.invitation, 0);
      expiredInvitationTargets += outcomes.reduce((total, outcome) => total + outcome.target, 0);
    }

    const staleTargetSnapshot = await firestore
      .collection("invitationTargets")
      .where("expiresAt", "<=", Timestamp.fromMillis(controlRecordCutoff))
      .limit(CLEANUP_BATCH_LIMIT)
      .get();
    for (let offset = 0; offset < staleTargetSnapshot.docs.length; offset += 10) {
      const outcomes = await Promise.all(
        staleTargetSnapshot.docs.slice(offset, offset + 10).map((snapshot) =>
          firestore.runTransaction(async (transaction) => {
            const target = await transaction.get(snapshot.ref);
            const data = target.data() ?? {};
            const expiresAt = data.expiresAt instanceof Timestamp ? data.expiresAt.toMillis() : 0;
            if (!target.exists || expiresAt <= 0 || expiresAt > controlRecordCutoff) {
              return { invitation: 0, target: 0 };
            }
            const invitationId = typeof data.invitationId === "string" ? data.invitationId : "";
            const invitationRef = invitationId
              ? firestore.collection("invitations").doc(invitationId)
              : null;
            const invitation = invitationRef ? await transaction.get(invitationRef) : null;
            const invitationData = invitation?.data() ?? {};
            const invitationExpiresAt = invitationData.expiresAt instanceof Timestamp
              ? invitationData.expiresAt.toMillis()
              : 0;
            if (
              invitation?.exists
              && invitationData.targetLockId === snapshot.id
              && invitationExpiresAt > controlRecordCutoff
            ) {
              return { invitation: 0, target: 0 };
            }
            let deletedInvitation = 0;
            if (
              invitationRef
              && invitation?.exists
              && invitationData.targetLockId === snapshot.id
              && invitationExpiresAt > 0
              && invitationExpiresAt <= controlRecordCutoff
            ) {
              transaction.delete(invitationRef);
              deletedInvitation = 1;
            }
            transaction.delete(snapshot.ref);
            return { invitation: deletedInvitation, target: 1 };
          }),
        ),
      );
      expiredInvitations += outcomes.reduce((total, outcome) => total + outcome.invitation, 0);
      expiredInvitationTargets += outcomes.reduce((total, outcome) => total + outcome.target, 0);
    }

    const cleanupBatch = firestore.batch();
    staleRateLimitSnapshot.docs.forEach((snapshot) => cleanupBatch.delete(snapshot.ref));
    if (!staleRateLimitSnapshot.empty) {
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
      expiredInvitations,
      expiredInvitationTargets,
      staleRateLimits: staleRateLimitSnapshot.size,
      deletedProjects,
    });
  },
);
