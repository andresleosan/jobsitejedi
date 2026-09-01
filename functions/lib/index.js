"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.cleanupOldProjects = exports.reviewInvoice = exports.extractJobsFromExcel = exports.submitInvoice = exports.createAssignedProject = exports.listAssignableBuilders = exports.reviewAccessRequest = exports.listAccessRequests = exports.submitAccessRequest = exports.getAccessRequestStatus = exports.consumeInvitation = exports.activateInvitation = exports.validateInvitationCode = exports.createManagerInvitation = void 0;
const node_crypto_1 = require("node:crypto");
const app_1 = require("firebase-admin/app");
const auth_1 = require("firebase-admin/auth");
const firestore_1 = require("firebase-admin/firestore");
const storage_1 = require("firebase-admin/storage");
const v2_1 = require("firebase-functions/v2");
const https_1 = require("firebase-functions/v2/https");
const scheduler_1 = require("firebase-functions/v2/scheduler");
const spreadsheet_js_1 = require("./spreadsheet.js");
const invoice_file_js_1 = require("./invoice-file.js");
const auth_session_js_1 = require("./auth-session.js");
const access_requests_js_1 = require("./access-requests.js");
(0, v2_1.setGlobalOptions)({ region: "europe-west1" });
// Evaluated only while Firebase discovers the deployment manifest. The release
// command must opt in explicitly after the observation gate; absence is safe.
const ENFORCE_APP_CHECK = process.env.ENFORCE_APP_CHECK === "true";
const appCheckOptions = { enforceAppCheck: ENFORCE_APP_CHECK };
(0, app_1.initializeApp)();
const INVITATION_TTL_MS = 30 * 60 * 1000;
const INVITATION_ASSIGNMENT_RECOVERY_MS = 2 * 60 * 1000;
const INVITATION_CODE_LENGTH = 12;
const INVITATION_SCHEMA_VERSION = 4;
const INVITATION_EMAIL_SALT_BYTES = 16;
const INVITATION_ENROLLMENT_ID_BYTES = 16;
const INVITATION_REQUEST_KEY_BYTES = 32;
const AUTHORIZATION_GRANT_ID_BYTES = 16;
const isAppRole = (value) => value === "admin" || value === "manager" || value === "builder";
const isManagementRole = (value) => value === "admin" || value === "manager";
const canInviteRole = (actorRole, targetRole) => targetRole === "builder" || (actorRole === "admin" && targetRole === "manager");
const isInvitationStatus = (value) => value === "pending" || value === "used";
const isInvitationClaimAssignmentState = (value) => value === "not_started"
    || value === "pending"
    || value === "completed"
    || value === "failed";
const isInvitationTargetStatus = (value) => value === "pending" || value === "assigning" || value === "completed" || value === "failed";
const isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
const isAccessRequestStatus = (value) => value === "pending"
    || value === "approving"
    || value === "approved"
    || value === "rejected";
const requireText = (value, label, maximumLength) => {
    if (typeof value !== "string") {
        throw new https_1.HttpsError("invalid-argument", `${label} is required`);
    }
    const normalized = value.trim();
    if (!normalized ||
        normalized.length > maximumLength ||
        [...normalized].some((character) => {
            const codePoint = character.codePointAt(0) ?? 0;
            return codePoint < 32 || codePoint === 127;
        })) {
        throw new https_1.HttpsError("invalid-argument", `${label} is invalid`);
    }
    return normalized;
};
const isIsoDate = (value) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value))
        return false;
    const date = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
};
const getInvoicePayload = (value, userId) => {
    if (!isRecord(value)) {
        throw new https_1.HttpsError("invalid-argument", "Invoice details are required");
    }
    const invoiceId = requireText(value.invoiceId, "Invoice id", 128);
    if (!/^[A-Za-z0-9_-]{10,128}$/.test(invoiceId)) {
        throw new https_1.HttpsError("invalid-argument", "Invoice id is invalid");
    }
    const projectId = requireText(value.projectId, "Project id", 128);
    const invoiceNumber = requireText(value.invoiceNumber, "Invoice number", 80);
    const supplierName = requireText(value.supplierName, "Supplier name", 120);
    const invoiceDate = requireText(value.invoiceDate, "Invoice date", 10);
    if (!isIsoDate(invoiceDate)) {
        throw new https_1.HttpsError("invalid-argument", "Invoice date must be a valid ISO date");
    }
    if (typeof value.totalAmountMinor !== "number" ||
        !Number.isSafeInteger(value.totalAmountMinor) ||
        value.totalAmountMinor <= 0 ||
        value.totalAmountMinor > 1_000_000_000_000) {
        throw new https_1.HttpsError("invalid-argument", "Invoice amount is invalid");
    }
    if (value.currency !== "GBP") {
        throw new https_1.HttpsError("invalid-argument", "Invoice currency must be GBP");
    }
    const notes = value.notes == null || value.notes === ""
        ? null
        : requireText(value.notes, "Invoice notes", 1_000);
    const originalFileName = requireText(value.originalFileName, "Invoice file name", 180);
    const quarantinePath = requireText(value.quarantinePath, "Invoice quarantine path", 500);
    if (quarantinePath !== `invoice-quarantine/${userId}/${invoiceId}/upload`) {
        throw new https_1.HttpsError("invalid-argument", "Invoice quarantine path is invalid");
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
const invoiceMatchesPayload = (current, payload, userId) => current.uploadedBy === userId &&
    current.projectId === payload.projectId &&
    current.invoiceNumber === payload.invoiceNumber &&
    current.supplierName === payload.supplierName &&
    current.invoiceDate === payload.invoiceDate &&
    current.totalAmountMinor === payload.totalAmountMinor &&
    current.currency === payload.currency &&
    current.notes === payload.notes;
const getReviewPayload = (value) => {
    if (!isRecord(value)) {
        throw new https_1.HttpsError("invalid-argument", "Invoice review details are required");
    }
    const invoiceId = requireText(value.invoiceId, "Invoice id", 128);
    if (!/^[A-Za-z0-9_-]{10,128}$/.test(invoiceId)) {
        throw new https_1.HttpsError("invalid-argument", "Invoice id is invalid");
    }
    if (value.status !== "approved" && value.status !== "rejected") {
        throw new https_1.HttpsError("invalid-argument", "Invoice review status is invalid");
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
        ? (0, storage_1.getStorage)().bucket(emulatorProjectId)
        : (0, storage_1.getStorage)().bucket();
};
const normalizeInvitationCode = (value) => {
    if (typeof value !== "string")
        return "";
    const code = value.trim().toUpperCase();
    return /^[A-Z0-9]{12}$/.test(code) ? code : "";
};
const hashInvitationCode = (code) => (0, node_crypto_1.createHash)("sha256").update(code).digest("hex");
const normalizeInvitationEmail = (value) => {
    if (typeof value !== "string")
        return "";
    const email = value.trim().toLowerCase();
    if (!email
        || email.length > 254
        || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return "";
    }
    return email;
};
const hashInvitationEmail = (email, salt) => (0, node_crypto_1.createHash)("sha256").update(`${salt}:${email}`).digest("hex");
const hashInvitationTargetKey = (email) => (0, node_crypto_1.createHash)("sha256").update(`invitation-target-v1:${email}`).digest("hex");
const hashInvitationEnrollmentId = (enrollmentId) => (0, node_crypto_1.createHash)("sha256").update(`invitation-enrollment-v1:${enrollmentId}`).digest("hex");
const normalizeInvitationRequestKey = (value) => {
    if (typeof value !== "string")
        return "";
    const requestKey = value.trim().toLowerCase();
    return /^[a-f0-9]{64}$/.test(requestKey) ? requestKey : "";
};
const hashInvitationRequestKey = (actorId, targetLockId, requestKey) => (0, node_crypto_1.createHash)("sha256")
    .update(`invitation-request-v1:${actorId}:${targetLockId}:${requestKey}`)
    .digest("hex");
const invitationEncryptionKey = (requestKey) => (0, node_crypto_1.createHash)("sha256")
    .update(`invitation-code-encryption-v1:${requestKey}`)
    .digest();
const encryptInvitationCode = (code, requestKey) => {
    const iv = (0, node_crypto_1.randomBytes)(12);
    const cipher = (0, node_crypto_1.createCipheriv)("aes-256-gcm", invitationEncryptionKey(requestKey), iv);
    const encrypted = Buffer.concat([cipher.update(code, "utf8"), cipher.final()]);
    return {
        encryptedCode: encrypted.toString("base64url"),
        codeEncryptionIv: iv.toString("base64url"),
        codeEncryptionTag: cipher.getAuthTag().toString("base64url"),
    };
};
const decryptInvitationCode = (encrypted, requestKey) => {
    try {
        const decipher = (0, node_crypto_1.createDecipheriv)("aes-256-gcm", invitationEncryptionKey(requestKey), Buffer.from(encrypted.codeEncryptionIv, "base64url"));
        decipher.setAuthTag(Buffer.from(encrypted.codeEncryptionTag, "base64url"));
        return Buffer.concat([
            decipher.update(Buffer.from(encrypted.encryptedCode, "base64url")),
            decipher.final(),
        ]).toString("utf8");
    }
    catch {
        return "";
    }
};
const isEncryptedInvitationCode = (value) => typeof value.encryptedCode === "string"
    && /^[A-Za-z0-9_-]{16}$/.test(value.encryptedCode)
    && typeof value.codeEncryptionIv === "string"
    && /^[A-Za-z0-9_-]{16}$/.test(value.codeEncryptionIv)
    && typeof value.codeEncryptionTag === "string"
    && /^[A-Za-z0-9_-]{22}$/.test(value.codeEncryptionTag);
const createInvitationCode = () => (0, node_crypto_1.randomBytes)(INVITATION_CODE_LENGTH / 2).toString("hex").toUpperCase();
const createInvitationPlaceholderPassword = () => `${(0, node_crypto_1.randomBytes)(48).toString("base64url")}Aa1!`;
const getAuthErrorCode = (error) => (typeof error === "object"
    && error !== null
    && "code" in error
    && typeof error.code === "string"
    ? error.code
    : "");
const getInvitationEnrollmentId = (user) => {
    const enrollmentId = user.customClaims?.invitationEnrollmentId;
    return typeof enrollmentId === "string" && /^[a-f0-9]{32}$/.test(enrollmentId)
        ? enrollmentId
        : "";
};
const getAuthorizationGrantId = (user) => {
    const grantId = user.customClaims?.authorizationGrantId;
    return typeof grantId === "string" && /^[a-f0-9]{32}$/.test(grantId)
        ? grantId
        : "";
};
const authorizationGrantMatches = (data, role, grantId) => Object.keys(data).sort().join(",") === "active,grantId,role,updatedAt"
    && data.active === true
    && data.role === role
    && data.grantId === grantId
    && data.updatedAt instanceof firestore_1.Timestamp;
const requireCurrentAuthorizationGrant = async (userId, role, grantId) => {
    if (!grantId) {
        throw new https_1.HttpsError("permission-denied", "A current authorized session is required");
    }
    const snapshot = await (0, firestore_1.getFirestore)().collection("authorizationGrants").doc(userId).get();
    if (!snapshot.exists || !authorizationGrantMatches(snapshot.data() ?? {}, role, grantId)) {
        throw new https_1.HttpsError("permission-denied", "A current authorized session is required");
    }
};
const requireEligibleInvitationTarget = (user) => {
    const enrollmentId = getInvitationEnrollmentId(user);
    if (user.disabled
        || user.customClaims?.role !== undefined
        || !enrollmentId) {
        throw new https_1.HttpsError("failed-precondition", "The target account is not eligible for self-service invitation enrollment");
    }
    return enrollmentId;
};
const getOrCreateInvitationTarget = async (targetEmail) => {
    try {
        const existing = await (0, auth_1.getAuth)().getUserByEmail(targetEmail);
        return {
            user: existing,
            enrollmentId: requireEligibleInvitationTarget(existing),
        };
    }
    catch (error) {
        if (error instanceof https_1.HttpsError)
            throw error;
        if (getAuthErrorCode(error) !== "auth/user-not-found") {
            throw new https_1.HttpsError("internal", "Unable to validate the target account");
        }
    }
    const enrollmentId = (0, node_crypto_1.randomBytes)(INVITATION_ENROLLMENT_ID_BYTES).toString("hex");
    let createdUser;
    try {
        createdUser = await (0, auth_1.getAuth)().createUser({
            email: targetEmail,
            emailVerified: false,
            disabled: false,
            password: createInvitationPlaceholderPassword(),
        });
    }
    catch (error) {
        if (getAuthErrorCode(error) !== "auth/email-already-exists") {
            throw new https_1.HttpsError("internal", "Unable to prepare the target account");
        }
        const racedUser = await (0, auth_1.getAuth)().getUserByEmail(targetEmail).catch(() => null);
        if (!racedUser) {
            throw new https_1.HttpsError("internal", "Unable to validate the target account");
        }
        return {
            user: racedUser,
            enrollmentId: requireEligibleInvitationTarget(racedUser),
        };
    }
    try {
        await (0, auth_1.getAuth)().setCustomUserClaims(createdUser.uid, {
            invitationEnrollmentId: enrollmentId,
        });
        const preparedUser = await (0, auth_1.getAuth)().getUser(createdUser.uid);
        if (getInvitationEnrollmentId(preparedUser) !== enrollmentId) {
            throw new Error("Invitation enrollment marker did not persist");
        }
        return { user: preparedUser, enrollmentId };
    }
    catch {
        await (0, auth_1.getAuth)().deleteUser(createdUser.uid).catch(() => undefined);
        throw new https_1.HttpsError("internal", "Unable to prepare the target account");
    }
};
const invalidInvitation = () => ({
    valid: false,
    role: null,
    expiresAt: null,
    errorMessage: "Invitation code is invalid or expired",
});
const invalidInvitationError = () => new https_1.HttpsError("failed-precondition", "Invitation code is invalid or expired");
const getDirectInvitationActivation = async (code, targetEmail) => {
    const firestore = (0, firestore_1.getFirestore)();
    const codeHash = hashInvitationCode(code);
    const invitations = await firestore
        .collection("invitations")
        .where("codeHash", "==", codeHash)
        .limit(2)
        .get();
    if (invitations.size !== 1)
        throw invalidInvitationError();
    const invitationReference = invitations.docs[0].ref;
    const invitationSnapshot = await invitationReference.get();
    const data = invitationSnapshot.data() ?? {};
    const targetLockId = hashInvitationTargetKey(targetEmail);
    const targetReference = firestore.collection("invitationTargets").doc(targetLockId);
    const targetSnapshot = await targetReference.get();
    const target = targetSnapshot.data() ?? {};
    const expiresAt = data.expiresAt instanceof firestore_1.Timestamp ? data.expiresAt.toMillis() : 0;
    const targetExpiresAt = target.expiresAt instanceof firestore_1.Timestamp
        ? target.expiresAt.toMillis()
        : 0;
    const targetEmailSalt = typeof data.targetEmailSalt === "string" ? data.targetEmailSalt : "";
    const targetEmailHash = targetEmailSalt
        ? hashInvitationEmail(targetEmail, targetEmailSalt)
        : "";
    if (data.schemaVersion !== INVITATION_SCHEMA_VERSION
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
        || targetExpiresAt !== expiresAt) {
        throw invalidInvitationError();
    }
    let targetUser;
    try {
        targetUser = await (0, auth_1.getAuth)().getUser(data.targetUid);
    }
    catch {
        throw invalidInvitationError();
    }
    const enrollmentId = getInvitationEnrollmentId(targetUser);
    if (targetUser.disabled
        || normalizeInvitationEmail(targetUser.email) !== targetEmail
        || targetUser.customClaims?.role !== undefined
        || !enrollmentId
        || hashInvitationEnrollmentId(enrollmentId) !== data.targetEnrollmentHash) {
        throw invalidInvitationError();
    }
    return { targetUid: data.targetUid, role: data.role };
};
const normalizeInvitationActivationPassword = (value) => {
    if (typeof value !== "string"
        || value.length < 8
        || value.length > 72
        || !/[A-Z]/.test(value)
        || !/[a-z]/.test(value)
        || !/[0-9]/.test(value)) {
        throw new https_1.HttpsError("invalid-argument", "Password does not meet the minimum requirements");
    }
    return value;
};
const getJobImportPayload = (value, managerId) => {
    if (!isRecord(value)) {
        throw new https_1.HttpsError("invalid-argument", "Spreadsheet import details are required");
    }
    const projectId = requireText(value.projectId, "Project id", 128);
    const filePath = requireText(value.filePath, "Spreadsheet file path", 500);
    const expectedPrefix = `job-imports/${managerId}/`;
    const fileName = filePath.slice(expectedPrefix.length);
    if (!filePath.startsWith(expectedPrefix)
        || !fileName
        || fileName.includes("/")
        || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,179}$/.test(fileName)
        || fileName.startsWith(".")
        || !/\.(csv|tsv|xlsx)$/i.test(fileName)) {
        throw new https_1.HttpsError("invalid-argument", "Spreadsheet file path is invalid");
    }
    return { projectId, filePath, fileName };
};
const optionalText = (value, label, maximumLength) => {
    if (value == null || value === "")
        return null;
    return requireText(value, label, maximumLength);
};
const getAssignedProjectPayload = (value) => {
    if (!isRecord(value)) {
        throw new https_1.HttpsError("invalid-argument", "Project details are required");
    }
    const projectId = requireText(value.projectId, "Project id", 128);
    if (!/^[A-Za-z0-9_-]{10,128}$/.test(projectId)) {
        throw new https_1.HttpsError("invalid-argument", "Project id is invalid");
    }
    const builderId = requireText(value.builderId, "Builder id", 128);
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(builderId)) {
        throw new https_1.HttpsError("invalid-argument", "Builder id is invalid");
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
const assignedProjectMatches = (current, payload, managerId) => current.builderId === payload.builderId
    && current.ownerId === payload.builderId
    && current.createdBy === managerId
    && current.name === payload.name
    && current.description === payload.description
    && current.clientName === payload.clientName
    && current.address === payload.address
    && current.status === "active";
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const RATE_LIMITS = {
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
    submitAccessRequest: { maxRequests: 3, windowMs: 15 * 60 * 1000 },
    getAccessRequestStatus: { maxRequests: 30, windowMs: 60 * 1000 },
    listAccessRequests: { maxRequests: 30, windowMs: 60 * 1000 },
    reviewAccessRequest: { maxRequests: 30, windowMs: 60 * 1000 },
};
const anonymizedRequesterId = (rawIp) => {
    const normalizedIp = rawIp?.split(",", 1)[0]?.trim() || "unknown";
    return (0, node_crypto_1.createHash)("sha256").update(`invitation-requester:${normalizedIp}`).digest("hex");
};
const getRateLimitReference = (operation, userId) => (0, firestore_1.getFirestore)()
    .collection("functionRateLimits")
    .doc((0, node_crypto_1.createHash)("sha256").update(`${operation}:${userId}`).digest("hex"));
const enforceRateLimit = async (subjectId, operation) => {
    const policy = RATE_LIMITS[operation];
    const now = Date.now();
    const reference = getRateLimitReference(operation, subjectId);
    await (0, firestore_1.getFirestore)().runTransaction(async (transaction) => {
        const snapshot = await transaction.get(reference);
        const data = snapshot.data() ?? {};
        const startedAt = data.windowStartedAt instanceof firestore_1.Timestamp
            ? data.windowStartedAt.toMillis()
            : 0;
        const requestCount = Number.isSafeInteger(data.requestCount) ? data.requestCount : 0;
        if (startedAt <= 0 || now - startedAt >= policy.windowMs || requestCount < 0) {
            transaction.set(reference, {
                operation,
                windowStartedAt: firestore_1.Timestamp.fromMillis(now),
                requestCount: 1,
                updatedAt: firestore_1.Timestamp.fromMillis(now),
            });
            return;
        }
        if (requestCount >= policy.maxRequests) {
            throw new https_1.HttpsError("resource-exhausted", "Too many requests; please try again later");
        }
        transaction.update(reference, {
            requestCount: requestCount + 1,
            updatedAt: firestore_1.Timestamp.fromMillis(now),
        });
    });
};
const getUserWithRetry = async (userId) => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
        try {
            return await (0, auth_1.getAuth)().getUser(userId);
        }
        catch (error) {
            if (typeof error !== "object" ||
                error === null ||
                !("code" in error) ||
                error.code !== "auth/user-not-found" ||
                attempt === 4) {
                throw new https_1.HttpsError("internal", "Unable to load the authenticated user");
            }
            await wait(50 * (attempt + 1));
        }
    }
    throw new https_1.HttpsError("internal", "Unable to load the authenticated user");
};
const requireCurrentRole = async (userId, tokenRole, tokenAuthorizationGrantId, tokenAuthTime, allowedRoles) => {
    const user = await getUserWithRetry(userId);
    const currentRole = user.customClaims?.role;
    const currentAuthorizationGrantId = getAuthorizationGrantId(user);
    if (user.disabled
        || !isAppRole(currentRole)
        || !allowedRoles.includes(currentRole)
        || currentRole !== tokenRole
        || !currentAuthorizationGrantId
        || currentAuthorizationGrantId !== tokenAuthorizationGrantId
        || !(0, auth_session_js_1.hasCurrentAuthSession)(user.tokensValidAfterTime, tokenAuthTime)) {
        throw new https_1.HttpsError("permission-denied", "A current authorized session is required");
    }
    await requireCurrentAuthorizationGrant(userId, currentRole, currentAuthorizationGrantId);
    return { user, role: currentRole };
};
const compensateInvitationAssignment = async (userId, invitationReference, targetReference) => {
    await (0, firestore_1.getFirestore)().runTransaction(async (transaction) => {
        const [invitationSnapshot, targetSnapshot] = await Promise.all([
            transaction.get(invitationReference),
            transaction.get(targetReference),
        ]);
        const invitation = invitationSnapshot.data() ?? {};
        const target = targetSnapshot.data() ?? {};
        if (invitationSnapshot.exists
            && targetSnapshot.exists
            && invitation.status === "used"
            && invitation.usedBy === userId
            && invitation.claimAssignmentState === "pending"
            && target.invitationId === invitationReference.id
            && target.status === "assigning") {
            transaction.update(invitationReference, {
                status: "pending",
                claimAssignmentState: "not_started",
                usedBy: null,
                usedAt: null,
            });
            transaction.update(targetReference, {
                status: "pending",
                updatedAt: firestore_1.Timestamp.now(),
            });
        }
    });
};
const failInvitationAssignment = async (userId, invitationReference, targetReference) => {
    await (0, firestore_1.getFirestore)().runTransaction(async (transaction) => {
        const [invitationSnapshot, targetSnapshot] = await Promise.all([
            transaction.get(invitationReference),
            transaction.get(targetReference),
        ]);
        const invitation = invitationSnapshot.data() ?? {};
        const target = targetSnapshot.data() ?? {};
        if (invitationSnapshot.exists
            && targetSnapshot.exists
            && invitation.status === "used"
            && invitation.usedBy === userId
            && invitation.claimAssignmentState === "pending"
            && target.invitationId === invitationReference.id) {
            transaction.update(invitationReference, {
                claimAssignmentState: "failed",
            });
            transaction.update(targetReference, {
                status: "failed",
                updatedAt: firestore_1.Timestamp.now(),
            });
        }
    });
};
const assignInvitationRole = async (userId, userEmail, role, invitationReference, targetReference) => {
    const latestUser = await getUserWithRetry(userId);
    const latestEmail = normalizeInvitationEmail(latestUser.email);
    const latestRole = latestUser.customClaims?.role;
    if (latestUser.disabled
        || !latestUser.emailVerified
        || latestEmail !== userEmail
        || (latestRole !== undefined && latestRole !== role)) {
        await failInvitationAssignment(userId, invitationReference, targetReference)
            .catch(() => console.error("Invitation assignment could not be failed closed", {
            operation: "consumeInvitation",
        }));
        throw new https_1.HttpsError("permission-denied", "The account is no longer eligible for this invitation");
    }
    const enrollmentId = getInvitationEnrollmentId(latestUser);
    let authorizationGrantId = getAuthorizationGrantId(latestUser);
    if (latestRole !== role || enrollmentId || !authorizationGrantId) {
        authorizationGrantId = (0, node_crypto_1.randomBytes)(AUTHORIZATION_GRANT_ID_BYTES).toString("hex");
        try {
            const preservedClaims = { ...(latestUser.customClaims ?? {}) };
            delete preservedClaims.invitationEnrollmentId;
            await (0, auth_1.getAuth)().setCustomUserClaims(userId, {
                ...preservedClaims,
                role,
                authorizationGrantId,
            });
        }
        catch {
            await compensateInvitationAssignment(userId, invitationReference, targetReference)
                .catch(() => console.error("Role assignment compensation failed", {
                operation: "consumeInvitation",
            }));
            throw new https_1.HttpsError("internal", "Unable to assign the account role; please retry");
        }
    }
    const assignedUser = await getUserWithRetry(userId);
    if (assignedUser.disabled
        || !assignedUser.emailVerified
        || normalizeInvitationEmail(assignedUser.email) !== userEmail
        || assignedUser.customClaims?.role !== role
        || getInvitationEnrollmentId(assignedUser)
        || getAuthorizationGrantId(assignedUser) !== authorizationGrantId) {
        await failInvitationAssignment(userId, invitationReference, targetReference)
            .catch(() => console.error("Invitation assignment verification could not fail closed", {
            operation: "consumeInvitation",
        }));
        throw new https_1.HttpsError("permission-denied", "The account role could not be verified after assignment");
    }
    const authorizationGrantReference = (0, firestore_1.getFirestore)()
        .collection("authorizationGrants")
        .doc(userId);
    try {
        await (0, firestore_1.getFirestore)().runTransaction(async (transaction) => {
            const [invitationSnapshot, targetSnapshot, authorizationGrantSnapshot] = await Promise.all([
                transaction.get(invitationReference),
                transaction.get(targetReference),
                transaction.get(authorizationGrantReference),
            ]);
            const invitation = invitationSnapshot.data() ?? {};
            const target = targetSnapshot.data() ?? {};
            if (!invitationSnapshot.exists
                || !targetSnapshot.exists
                || invitation.status !== "used"
                || invitation.usedBy !== userId
                || target.invitationId !== invitationReference.id) {
                throw new https_1.HttpsError("failed-precondition", "Invitation assignment state is inconsistent");
            }
            if (invitation.claimAssignmentState === "completed") {
                if (target.status !== "completed"
                    || !authorizationGrantSnapshot.exists
                    || !authorizationGrantMatches(authorizationGrantSnapshot.data() ?? {}, role, authorizationGrantId)) {
                    throw new https_1.HttpsError("failed-precondition", "A completed invitation cannot restore a changed or revoked role");
                }
                return;
            }
            if (invitation.claimAssignmentState !== "pending" || target.status !== "assigning") {
                throw new https_1.HttpsError("failed-precondition", "Invitation assignment is not recoverable");
            }
            const completedAt = firestore_1.Timestamp.now();
            transaction.create(authorizationGrantReference, {
                active: true,
                role,
                grantId: authorizationGrantId,
                updatedAt: completedAt,
            });
            transaction.update(invitationReference, {
                claimAssignmentState: "completed",
                claimAssignedAt: completedAt,
            });
            transaction.update(targetReference, {
                status: "completed",
                updatedAt: completedAt,
            });
        });
    }
    catch {
        throw new https_1.HttpsError("internal", "The role was assigned but confirmation is pending; retry the invitation");
    }
    const confirmedGrant = await authorizationGrantReference.get().catch(() => null);
    if (!confirmedGrant?.exists
        || !authorizationGrantMatches(confirmedGrant.data() ?? {}, role, authorizationGrantId)) {
        throw new https_1.HttpsError("permission-denied", "The account authorization grant could not be verified after assignment");
    }
};
exports.createManagerInvitation = (0, https_1.onCall)(appCheckOptions, async (request) => {
    const tokenRole = request.auth?.token.role;
    if (!request.auth || !isManagementRole(tokenRole)) {
        throw new https_1.HttpsError("permission-denied", "Admin or manager role is required");
    }
    const actorId = request.auth.uid;
    if (!isRecord(request.data) || !isAppRole(request.data.role)) {
        throw new https_1.HttpsError("invalid-argument", "A valid invitation role is required");
    }
    const targetEmail = normalizeInvitationEmail(request.data.targetEmail);
    if (!targetEmail) {
        throw new https_1.HttpsError("invalid-argument", "A valid target email is required");
    }
    const requestKey = normalizeInvitationRequestKey(request.data.requestKey);
    if (!requestKey) {
        throw new https_1.HttpsError("invalid-argument", "A valid invitation request key is required");
    }
    const { role: actorRole } = await requireCurrentRole(actorId, tokenRole, request.auth.token.authorizationGrantId, request.auth.token.auth_time, ["admin", "manager"]);
    if (!isManagementRole(actorRole)) {
        throw new https_1.HttpsError("permission-denied", "Admin or manager role is required");
    }
    if (!canInviteRole(actorRole, request.data.role)) {
        throw new https_1.HttpsError("permission-denied", "Admin enrollment is restricted to the controlled administrative runbook");
    }
    if (request.data.role === "manager"
        && !(0, auth_session_js_1.hasRecentAuthentication)(request.auth.token.auth_time)) {
        throw new https_1.HttpsError("failed-precondition", "Sign in again before creating a manager invitation");
    }
    await enforceRateLimit(actorId, "createManagerInvitation");
    const targetLockId = hashInvitationTargetKey(targetEmail);
    const requestKeyHash = hashInvitationRequestKey(actorId, targetLockId, requestKey);
    const targetAccount = await getOrCreateInvitationTarget(targetEmail);
    const targetUid = targetAccount.user.uid;
    const targetEnrollmentHash = hashInvitationEnrollmentId(targetAccount.enrollmentId);
    const code = createInvitationCode();
    const encryptedCode = encryptInvitationCode(code, requestKey);
    const targetEmailSalt = (0, node_crypto_1.randomBytes)(INVITATION_EMAIL_SALT_BYTES).toString("hex");
    const expiresAt = firestore_1.Timestamp.fromMillis(Date.now() + INVITATION_TTL_MS);
    const createdAt = firestore_1.Timestamp.now();
    const firestore = (0, firestore_1.getFirestore)();
    const invitationReference = firestore.collection("invitations").doc();
    const targetReference = firestore.collection("invitationTargets").doc(targetLockId);
    const result = await firestore.runTransaction(async (transaction) => {
        const targetSnapshot = await transaction.get(targetReference);
        const activeTarget = targetSnapshot.data() ?? {};
        const activeUntil = activeTarget.expiresAt instanceof firestore_1.Timestamp
            ? activeTarget.expiresAt.toMillis()
            : 0;
        if (targetSnapshot.exists
            && (activeTarget.status === "pending" || activeTarget.status === "assigning")
            && activeUntil > Date.now()) {
            if (activeTarget.requestKeyHash !== requestKeyHash
                || typeof activeTarget.invitationId !== "string") {
                throw new https_1.HttpsError("already-exists", "An active invitation already exists for this email");
            }
            const existingReference = firestore.collection("invitations").doc(activeTarget.invitationId);
            const existingSnapshot = await transaction.get(existingReference);
            const existing = existingSnapshot.data() ?? {};
            const existingExpiresAt = existing.expiresAt instanceof firestore_1.Timestamp
                ? existing.expiresAt
                : null;
            if (!existingSnapshot.exists
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
                || !isEncryptedInvitationCode(existing)) {
                throw new https_1.HttpsError("failed-precondition", "The active invitation cannot be recovered safely");
            }
            return {
                encryptedCode: existing.encryptedCode,
                codeEncryptionIv: existing.codeEncryptionIv,
                codeEncryptionTag: existing.codeEncryptionTag,
                codeHash: existing.codeHash,
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
            status: "pending",
            claimAssignmentState: "not_started",
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
            status: "pending",
            expiresAt,
            createdAt,
            updatedAt: createdAt,
        });
        return { ...encryptedCode, codeHash: hashInvitationCode(code), expiresAt };
    });
    const recoveredCode = decryptInvitationCode(result, requestKey);
    if (!normalizeInvitationCode(recoveredCode)
        || !/^[a-f0-9]{64}$/.test(result.codeHash)
        || hashInvitationCode(recoveredCode) !== result.codeHash) {
        throw new https_1.HttpsError("internal", "The invitation code could not be recovered safely");
    }
    return {
        code: recoveredCode,
        role: request.data.role,
        expiresAt: result.expiresAt.toDate().toISOString(),
    };
});
exports.validateInvitationCode = (0, https_1.onCall)({ ...appCheckOptions, timeoutSeconds: 10, memory: "256MiB", maxInstances: 2 }, async (request) => {
    // This endpoint must remain public so a new user can validate an invitation
    // before authenticating. A requester-partitioned quota limits abuse without
    // storing the source IP, while an emergency global ceiling bounds aggregate
    // Firestore work until App Check enforcement is enabled after observation.
    await Promise.all([
        enforceRateLimit(anonymizedRequesterId(request.rawRequest.ip), "validateInvitationCodeRequester"),
        enforceRateLimit("public-emergency-ceiling", "validateInvitationCodeGlobal"),
    ]);
    const payload = isRecord(request.data)
        ? request.data
        : { code: request.data };
    const code = normalizeInvitationCode(payload.code);
    if (!code)
        return invalidInvitation();
    const requestedTargetEmail = payload.targetEmail === undefined
        ? null
        : normalizeInvitationEmail(payload.targetEmail);
    if (payload.targetEmail !== undefined && !requestedTargetEmail)
        return invalidInvitation();
    const snapshot = await (0, firestore_1.getFirestore)()
        .collection("invitations")
        .where("codeHash", "==", hashInvitationCode(code))
        .limit(2)
        .get();
    if (snapshot.size !== 1)
        return invalidInvitation();
    const invitation = snapshot.docs[0];
    const data = invitation.data();
    const expiresAt = data.expiresAt instanceof firestore_1.Timestamp ? data.expiresAt.toMillis() : 0;
    const targetEmailSalt = typeof data.targetEmailSalt === "string" ? data.targetEmailSalt : "";
    const targetLockId = typeof data.targetLockId === "string" ? data.targetLockId : "";
    const requestedTargetHash = requestedTargetEmail && targetEmailSalt
        ? hashInvitationEmail(requestedTargetEmail, targetEmailSalt)
        : null;
    const targetSnapshot = /^[a-f0-9]{64}$/.test(targetLockId)
        ? await (0, firestore_1.getFirestore)().collection("invitationTargets").doc(targetLockId).get()
        : null;
    const target = targetSnapshot?.data() ?? {};
    const targetExpiresAt = target.expiresAt instanceof firestore_1.Timestamp
        ? target.expiresAt.toMillis()
        : 0;
    if (data.schemaVersion !== INVITATION_SCHEMA_VERSION
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
        || targetExpiresAt !== expiresAt) {
        return invalidInvitation();
    }
    return {
        valid: true,
        role: data.role,
        expiresAt: new Date(expiresAt).toISOString(),
        errorMessage: null,
    };
});
exports.activateInvitation = (0, https_1.onCall)(appCheckOptions, async (request) => {
    await enforceRateLimit(anonymizedRequesterId(request.rawRequest.ip), "activateInvitation");
    if (!isRecord(request.data)) {
        throw new https_1.HttpsError("invalid-argument", "Invitation activation details are required");
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
        await (0, auth_1.getAuth)().updateUser(activation.targetUid, {
            password,
            displayName: fullName,
            emailVerified: true,
        });
    }
    catch {
        throw new https_1.HttpsError("internal", "Unable to activate the invited account");
    }
    return { activated: true, role: activation.role };
});
exports.consumeInvitation = (0, https_1.onCall)(appCheckOptions, async (request) => {
    if (!request.auth) {
        throw new https_1.HttpsError("unauthenticated", "Authentication is required");
    }
    const code = normalizeInvitationCode(isRecord(request.data) ? request.data.code : null);
    if (!code)
        throw new https_1.HttpsError("invalid-argument", "A valid invitation code is required");
    const firestore = (0, firestore_1.getFirestore)();
    const userId = request.auth.uid;
    await enforceRateLimit(userId, "consumeInvitation");
    const user = await getUserWithRetry(userId);
    const userEmail = normalizeInvitationEmail(user.email);
    if (user.disabled
        || !userEmail
        || !(0, auth_session_js_1.hasCurrentAuthSession)(user.tokensValidAfterTime, request.auth.token.auth_time)) {
        throw new https_1.HttpsError("permission-denied", "An active account with a valid email is required");
    }
    if (!user.emailVerified) {
        throw new https_1.HttpsError("failed-precondition", "Verify the account email before accepting the invitation", { reason: "email-not-verified" });
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
    if (invitations.size !== 1)
        throw invalidInvitationError();
    const invitationRef = invitations.docs[0].ref;
    const targetLockId = hashInvitationTargetKey(userEmail);
    const targetRef = firestore.collection("invitationTargets").doc(targetLockId);
    const result = await firestore.runTransaction(async (transaction) => {
        const [snapshot, targetSnapshot] = await Promise.all([
            transaction.get(invitationRef),
            transaction.get(targetRef),
        ]);
        if (!snapshot.exists || !targetSnapshot.exists)
            throw invalidInvitationError();
        const data = snapshot.data() ?? {};
        const target = targetSnapshot.data() ?? {};
        const expiresAt = data.expiresAt instanceof firestore_1.Timestamp ? data.expiresAt.toMillis() : 0;
        const targetExpiresAt = target.expiresAt instanceof firestore_1.Timestamp
            ? target.expiresAt.toMillis()
            : 0;
        const targetEmailSalt = typeof data.targetEmailSalt === "string" ? data.targetEmailSalt : "";
        const targetEmailHash = targetEmailSalt
            ? hashInvitationEmail(userEmail, targetEmailSalt)
            : "";
        if (data.schemaVersion !== INVITATION_SCHEMA_VERSION
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
            || targetExpiresAt !== expiresAt) {
            throw invalidInvitationError();
        }
        if (data.status === "used") {
            if (data.usedBy !== userId)
                throw invalidInvitationError();
            if (data.claimAssignmentState === "completed") {
                if (target.status !== "completed") {
                    throw new https_1.HttpsError("failed-precondition", "Invitation assignment state is inconsistent");
                }
                return { role: data.role, shouldAssign: false, verifyCompleted: true };
            }
            if (data.claimAssignmentState === "failed") {
                throw new https_1.HttpsError("failed-precondition", "Invitation assignment requires administrator recovery");
            }
            if (data.claimAssignmentState !== "pending" || target.status !== "assigning") {
                throw invalidInvitationError();
            }
            if (currentRole !== undefined && currentRole !== data.role) {
                throw new https_1.HttpsError("permission-denied", "The invitation role conflicts with the current account");
            }
            const originalEnrollmentMatches = Boolean(enrollmentId)
                && data.targetEnrollmentHash === currentEnrollmentHash;
            const partialAssignmentMatches = currentRole === data.role && !enrollmentId;
            if (!originalEnrollmentMatches && !partialAssignmentMatches) {
                throw invalidInvitationError();
            }
            const usedAt = data.usedAt instanceof firestore_1.Timestamp ? data.usedAt.toMillis() : 0;
            if (usedAt <= 0 || Date.now() - usedAt > INVITATION_ASSIGNMENT_RECOVERY_MS) {
                throw new https_1.HttpsError("failed-precondition", "Invitation assignment recovery window has closed");
            }
            return { role: data.role, shouldAssign: true, verifyCompleted: false };
        }
        if (data.claimAssignmentState !== "not_started"
            || target.status !== "pending"
            || expiresAt <= Date.now()) {
            throw invalidInvitationError();
        }
        if (currentRole !== undefined && currentRole !== data.role) {
            throw new https_1.HttpsError("permission-denied", "The invitation role conflicts with the current account");
        }
        const originalEnrollmentMatches = Boolean(enrollmentId)
            && data.targetEnrollmentHash === currentEnrollmentHash;
        const compensatedAssignmentMatches = currentRole === data.role && !enrollmentId;
        if (!originalEnrollmentMatches && !compensatedAssignmentMatches) {
            throw invalidInvitationError();
        }
        const now = firestore_1.Timestamp.now();
        transaction.update(invitationRef, {
            status: "used",
            claimAssignmentState: "pending",
            usedBy: userId,
            usedAt: now,
            claimAssignedAt: null,
        });
        transaction.update(targetRef, {
            status: "assigning",
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
        if (completedUser.disabled
            || !completedUser.emailVerified
            || completedUser.customClaims?.role !== result.role
            || !completedGrantId) {
            throw new https_1.HttpsError("permission-denied", "A completed invitation cannot restore a changed or revoked role");
        }
        await requireCurrentAuthorizationGrant(userId, result.role, completedGrantId);
    }
    if (result.shouldAssign) {
        await assignInvitationRole(userId, userEmail, result.role, invitationRef, targetRef);
    }
    return { role: result.role };
});
const accessRequestReference = (requestId) => (0, firestore_1.getFirestore)().collection("accessRequests").doc(requestId);
const accessRequestIsCurrent = (data, requestId) => (data.schemaVersion === access_requests_js_1.ACCESS_REQUEST_SCHEMA_VERSION
    && data.uid === requestId
    && typeof data.email === "string"
    && typeof data.fullName === "string"
    && isAppRole(data.requestedRole)
    && isAccessRequestStatus(data.status));
const accessRequestResponse = (requestId, data) => ({
    id: requestId,
    email: typeof data.email === "string" ? data.email : "",
    fullName: typeof data.fullName === "string" ? data.fullName : "",
    phone: typeof data.phone === "string" ? data.phone : null,
    requestedRole: isAppRole(data.requestedRole) ? data.requestedRole : null,
    status: isAccessRequestStatus(data.status) ? data.status : "rejected",
    requestedAt: data.requestedAt instanceof firestore_1.Timestamp ? data.requestedAt.toDate().toISOString() : null,
    reviewedAt: data.reviewedAt instanceof firestore_1.Timestamp ? data.reviewedAt.toDate().toISOString() : null,
    decisionReason: typeof data.decisionReason === "string" ? data.decisionReason : null,
});
exports.getAccessRequestStatus = (0, https_1.onCall)({ ...appCheckOptions, timeoutSeconds: 15, memory: "256MiB", maxInstances: 10 }, async (request) => {
    if (!request.auth) {
        throw new https_1.HttpsError("unauthenticated", "Authentication is required");
    }
    await enforceRateLimit(request.auth.uid, "getAccessRequestStatus");
    const snapshot = await accessRequestReference(request.auth.uid).get();
    if (!snapshot.exists)
        return { status: null, requestedRole: null };
    const data = snapshot.data() ?? {};
    if (!accessRequestIsCurrent(data, request.auth.uid)) {
        return { status: null, requestedRole: null };
    }
    return {
        status: data.status,
        requestedRole: data.requestedRole,
    };
});
exports.submitAccessRequest = (0, https_1.onCall)({ ...appCheckOptions, timeoutSeconds: 15, memory: "256MiB", maxInstances: 10 }, async (request) => {
    if (!request.auth) {
        throw new https_1.HttpsError("unauthenticated", "Authentication is required");
    }
    let payload;
    try {
        payload = (0, access_requests_js_1.normalizeAccessRequestInput)(request.data);
    }
    catch (error) {
        throw new https_1.HttpsError("invalid-argument", error instanceof Error ? error.message : "Access request details are invalid");
    }
    const user = await getUserWithRetry(request.auth.uid);
    const email = normalizeInvitationEmail(user.email);
    if (!email || user.disabled) {
        throw new https_1.HttpsError("failed-precondition", "The account cannot submit an access request");
    }
    if (isAppRole(user.customClaims?.role)) {
        throw new https_1.HttpsError("failed-precondition", "The account is already authorized");
    }
    await enforceRateLimit(request.auth.uid, "submitAccessRequest");
    const reference = accessRequestReference(request.auth.uid);
    const now = firestore_1.Timestamp.now();
    const existingSnapshot = await reference.get();
    const existing = existingSnapshot.data() ?? {};
    if (existingSnapshot.exists
        && (existing.status === "pending" || existing.status === "approving")) {
        if (existing.email === email
            && existing.requestedRole === payload.requestedRole) {
            return { status: existing.status, requestedRole: payload.requestedRole };
        }
        throw new https_1.HttpsError("already-exists", "An access request is already pending");
    }
    if (existingSnapshot.exists && existing.status === "approved") {
        throw new https_1.HttpsError("failed-precondition", "The account authorization state is inconsistent");
    }
    await (0, firestore_1.getFirestore)().runTransaction(async (transaction) => {
        const latestSnapshot = await transaction.get(reference);
        const latest = latestSnapshot.data() ?? {};
        if (latestSnapshot.exists && (latest.status === "pending" || latest.status === "approving")) {
            throw new https_1.HttpsError("already-exists", "An access request is already pending");
        }
        transaction.set(reference, {
            schemaVersion: access_requests_js_1.ACCESS_REQUEST_SCHEMA_VERSION,
            uid: request.auth?.uid,
            email,
            fullName: payload.fullName,
            phone: payload.phone,
            requestedRole: payload.requestedRole,
            status: "pending",
            requestedAt: now,
            updatedAt: now,
            approvalStartedAt: null,
            reviewedAt: null,
            reviewedBy: null,
            decisionReason: null,
        });
    });
    return { status: "pending", requestedRole: payload.requestedRole };
});
exports.listAccessRequests = (0, https_1.onCall)({ ...appCheckOptions, timeoutSeconds: 15, memory: "256MiB", maxInstances: 10 }, async (request) => {
    if (!request.auth) {
        throw new https_1.HttpsError("unauthenticated", "Authentication is required");
    }
    const { user } = await requireCurrentRole(request.auth.uid, request.auth.token.role, request.auth.token.authorizationGrantId, request.auth.token.auth_time, ["admin"]);
    await enforceRateLimit(user.uid, "listAccessRequests");
    const firestore = (0, firestore_1.getFirestore)();
    const snapshots = await Promise.all([
        firestore.collection("accessRequests").where("status", "==", "pending").orderBy("requestedAt", "desc").limit(100).get(),
        firestore.collection("accessRequests").where("status", "==", "approving").orderBy("requestedAt", "desc").limit(100).get(),
    ]);
    const requests = snapshots.flatMap((snapshot) => snapshot.docs)
        .map((document) => ({ id: document.id, data: document.data() }))
        .filter(({ id, data }) => accessRequestIsCurrent(data, id))
        .sort((left, right) => {
        const leftMillis = left.data.requestedAt instanceof firestore_1.Timestamp ? left.data.requestedAt.toMillis() : 0;
        const rightMillis = right.data.requestedAt instanceof firestore_1.Timestamp ? right.data.requestedAt.toMillis() : 0;
        return rightMillis - leftMillis;
    })
        .slice(0, 100)
        .map(({ id, data }) => accessRequestResponse(id, data));
    return { requests };
});
const restoreAccessRequestAuthorization = async ({ requestId, previousClaims, previousGrant, previousGrantExists, nextGrant, }) => {
    await (0, auth_1.getAuth)().setCustomUserClaims(requestId, previousClaims);
    const reference = accessRequestReference(requestId);
    const grantReference = (0, firestore_1.getFirestore)().collection("authorizationGrants").doc(requestId);
    await (0, firestore_1.getFirestore)().runTransaction(async (transaction) => {
        const [requestSnapshot, grantSnapshot] = await Promise.all([
            transaction.get(reference),
            transaction.get(grantReference),
        ]);
        if (requestSnapshot.exists
            && grantSnapshot.exists
            && authorizationGrantMatches(grantSnapshot.data() ?? {}, nextGrant.role, nextGrant.grantId)) {
            if (previousGrantExists && previousGrant)
                transaction.set(grantReference, previousGrant);
            else
                transaction.delete(grantReference);
            if (requestSnapshot.data()?.status === "approving") {
                transaction.update(reference, {
                    status: "pending",
                    approvalStartedAt: null,
                    reviewedAt: null,
                    reviewedBy: null,
                    updatedAt: firestore_1.Timestamp.now(),
                });
            }
        }
    });
    await (0, auth_1.getAuth)().revokeRefreshTokens(requestId).catch(() => undefined);
};
exports.reviewAccessRequest = (0, https_1.onCall)({ ...appCheckOptions, timeoutSeconds: 30, memory: "256MiB", maxInstances: 10 }, async (request) => {
    if (!request.auth) {
        throw new https_1.HttpsError("unauthenticated", "Authentication is required");
    }
    const { user: reviewer } = await requireCurrentRole(request.auth.uid, request.auth.token.role, request.auth.token.authorizationGrantId, request.auth.token.auth_time, ["admin"]);
    if (!(0, auth_session_js_1.hasRecentAuthentication)(request.auth.token.auth_time)) {
        throw new https_1.HttpsError("permission-denied", "Sign in again before reviewing access requests");
    }
    let payload;
    try {
        payload = (0, access_requests_js_1.normalizeAccessRequestReviewInput)(request.data);
    }
    catch (error) {
        throw new https_1.HttpsError("invalid-argument", error instanceof Error ? error.message : "Access request review details are invalid");
    }
    await enforceRateLimit(reviewer.uid, "reviewAccessRequest");
    const reference = accessRequestReference(payload.requestId);
    const snapshot = await reference.get();
    if (!snapshot.exists || !accessRequestIsCurrent(snapshot.data() ?? {}, payload.requestId)) {
        throw new https_1.HttpsError("not-found", "Access request was not found");
    }
    const current = snapshot.data();
    if (current.status === "approved" || current.status === "rejected") {
        return accessRequestResponse(payload.requestId, current);
    }
    if (payload.decision === "reject") {
        if (current.status !== "pending") {
            throw new https_1.HttpsError("failed-precondition", "The access request is already being reviewed");
        }
        const now = firestore_1.Timestamp.now();
        await (0, firestore_1.getFirestore)().runTransaction(async (transaction) => {
            const latest = await transaction.get(reference);
            if (latest.data()?.status !== "pending") {
                throw new https_1.HttpsError("failed-precondition", "The access request is already being reviewed");
            }
            transaction.update(reference, {
                status: "rejected",
                reviewedAt: now,
                reviewedBy: reviewer.uid,
                decisionReason: payload.reason,
                updatedAt: now,
            });
        });
        return accessRequestResponse(payload.requestId, {
            ...current,
            status: "rejected",
            reviewedAt: now,
            reviewedBy: reviewer.uid,
            decisionReason: payload.reason,
        });
    }
    const targetUser = await getUserWithRetry(payload.requestId);
    const targetEmail = normalizeInvitationEmail(targetUser.email);
    if (targetUser.disabled || targetEmail !== current.email) {
        throw new https_1.HttpsError("failed-precondition", "The requested account is not active or does not match");
    }
    if (targetUser.customClaims?.invitationEnrollmentId !== undefined) {
        throw new https_1.HttpsError("failed-precondition", "The account belongs to the invitation enrollment flow");
    }
    const targetRole = current.requestedRole;
    const previousClaims = JSON.parse(JSON.stringify(targetUser.customClaims ?? {}));
    const previousGrantReference = (0, firestore_1.getFirestore)().collection("authorizationGrants").doc(payload.requestId);
    const previousGrantSnapshot = await previousGrantReference.get();
    const previousGrant = previousGrantSnapshot.exists ? previousGrantSnapshot.data() ?? null : null;
    const previousRole = targetUser.customClaims?.role;
    if (previousRole !== undefined && previousRole !== targetRole) {
        throw new https_1.HttpsError("failed-precondition", "The account already has a different role");
    }
    const existingGrantId = getAuthorizationGrantId(targetUser);
    if (previousRole === targetRole && existingGrantId && authorizationGrantMatches(previousGrant ?? {}, targetRole, existingGrantId)) {
        const now = firestore_1.Timestamp.now();
        await reference.update({
            status: "approved",
            reviewedAt: now,
            reviewedBy: reviewer.uid,
            decisionReason: null,
            updatedAt: now,
        });
        return accessRequestResponse(payload.requestId, { ...current, status: "approved", reviewedAt: now, reviewedBy: reviewer.uid, decisionReason: null });
    }
    if (current.status !== "pending") {
        throw new https_1.HttpsError("failed-precondition", "The access request is already being reviewed");
    }
    const grantId = (0, node_crypto_1.randomBytes)(AUTHORIZATION_GRANT_ID_BYTES).toString("hex");
    const nextGrant = {
        active: true,
        role: targetRole,
        grantId,
        updatedAt: firestore_1.Timestamp.now(),
    };
    const startedAt = firestore_1.Timestamp.now();
    await (0, firestore_1.getFirestore)().runTransaction(async (transaction) => {
        const [requestSnapshot, grantSnapshot] = await Promise.all([
            transaction.get(reference),
            transaction.get(previousGrantReference),
        ]);
        const latest = requestSnapshot.data() ?? {};
        if (!requestSnapshot.exists || latest.status !== "pending") {
            throw new https_1.HttpsError("failed-precondition", "The access request is no longer pending");
        }
        if (grantSnapshot.exists && grantSnapshot.data()?.active === true && previousRole === undefined) {
            throw new https_1.HttpsError("failed-precondition", "The account authorization state changed");
        }
        transaction.set(previousGrantReference, nextGrant);
        transaction.update(reference, {
            status: "approving",
            approvalStartedAt: startedAt,
            reviewedBy: reviewer.uid,
            updatedAt: startedAt,
        });
    });
    const nextClaims = { ...previousClaims, role: targetRole, authorizationGrantId: grantId };
    try {
        await (0, auth_1.getAuth)().setCustomUserClaims(payload.requestId, nextClaims);
        await (0, auth_1.getAuth)().revokeRefreshTokens(payload.requestId);
        const [verifiedUser, verifiedGrant] = await Promise.all([
            (0, auth_1.getAuth)().getUser(payload.requestId),
            previousGrantReference.get(),
        ]);
        if (verifiedUser.disabled
            || verifiedUser.customClaims?.role !== targetRole
            || verifiedUser.customClaims?.authorizationGrantId !== grantId
            || !verifiedGrant.exists
            || !authorizationGrantMatches(verifiedGrant.data() ?? {}, targetRole, grantId)) {
            throw new Error("Access request authorization could not be verified");
        }
        const completedAt = firestore_1.Timestamp.now();
        await (0, firestore_1.getFirestore)().runTransaction(async (transaction) => {
            const latest = await transaction.get(reference);
            if (latest.data()?.status !== "approving") {
                throw new https_1.HttpsError("failed-precondition", "The access request changed during approval");
            }
            transaction.update(reference, {
                status: "approved",
                reviewedAt: completedAt,
                reviewedBy: reviewer.uid,
                decisionReason: null,
                updatedAt: completedAt,
            });
        });
        return accessRequestResponse(payload.requestId, { ...current, status: "approved", reviewedAt: completedAt, reviewedBy: reviewer.uid, decisionReason: null });
    }
    catch (error) {
        await restoreAccessRequestAuthorization({
            requestId: payload.requestId,
            previousClaims,
            previousGrant,
            previousGrantExists: previousGrantSnapshot.exists,
            nextGrant,
        }).catch(() => undefined);
        if (error instanceof https_1.HttpsError)
            throw error;
        throw new https_1.HttpsError("internal", "The access request could not be approved safely");
    }
});
exports.listAssignableBuilders = (0, https_1.onCall)({ ...appCheckOptions, timeoutSeconds: 15, memory: "256MiB", maxInstances: 10 }, async (request) => {
    if (!request.auth) {
        throw new https_1.HttpsError("unauthenticated", "Authentication is required");
    }
    await requireCurrentRole(request.auth.uid, request.auth.token.role, request.auth.token.authorizationGrantId, request.auth.token.auth_time, ["admin", "manager"]);
    await enforceRateLimit(request.auth.uid, "listAssignableBuilders");
    const page = await (0, auth_1.getAuth)().listUsers(1_000);
    const builders = page.users
        .filter((user) => !user.disabled && user.customClaims?.role === "builder")
        .map((user) => ({
        id: user.uid,
        email: user.email ?? null,
        displayName: user.displayName?.trim() || null,
    }))
        .sort((left, right) => (left.displayName ?? left.email ?? left.id).localeCompare(right.displayName ?? right.email ?? right.id));
    return { builders };
});
exports.createAssignedProject = (0, https_1.onCall)({ ...appCheckOptions, timeoutSeconds: 15, memory: "256MiB", maxInstances: 10 }, async (request) => {
    if (!request.auth) {
        throw new https_1.HttpsError("unauthenticated", "Authentication is required");
    }
    await requireCurrentRole(request.auth.uid, request.auth.token.role, request.auth.token.authorizationGrantId, request.auth.token.auth_time, ["admin", "manager"]);
    const payload = getAssignedProjectPayload(request.data);
    const managerId = request.auth.uid;
    await enforceRateLimit(managerId, "createAssignedProject");
    let builder;
    try {
        builder = await (0, auth_1.getAuth)().getUser(payload.builderId);
    }
    catch (error) {
        if (typeof error === "object"
            && error !== null
            && "code" in error
            && error.code === "auth/user-not-found") {
            throw new https_1.HttpsError("failed-precondition", "The selected builder is not provisioned");
        }
        throw new https_1.HttpsError("internal", "Unable to validate the selected builder");
    }
    if (builder.disabled || builder.customClaims?.role !== "builder") {
        throw new https_1.HttpsError("failed-precondition", "The selected builder is not active or authorized");
    }
    const firestore = (0, firestore_1.getFirestore)();
    const projectReference = firestore.collection("projects").doc(payload.projectId);
    await firestore.runTransaction(async (transaction) => {
        const existing = await transaction.get(projectReference);
        if (existing.exists) {
            if (!assignedProjectMatches(existing.data() ?? {}, payload, managerId)) {
                throw new https_1.HttpsError("already-exists", "Project id is already in use");
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
            createdAt: firestore_1.Timestamp.now(),
            updatedAt: firestore_1.Timestamp.now(),
        });
    });
    return { projectId: payload.projectId };
});
exports.submitInvoice = (0, https_1.onCall)({ ...appCheckOptions, timeoutSeconds: 60, memory: "512MiB", maxInstances: 5 }, async (request) => {
    if (!request.auth) {
        throw new https_1.HttpsError("unauthenticated", "Authentication is required");
    }
    const { user: builder } = await requireCurrentRole(request.auth.uid, request.auth.token.role, request.auth.token.authorizationGrantId, request.auth.token.auth_time, ["builder"]);
    const userId = request.auth.uid;
    await enforceRateLimit(userId, "submitInvoice");
    const uploadedByName = builder.displayName?.trim() || null;
    const payload = getInvoicePayload(request.data, userId);
    const firestore = (0, firestore_1.getFirestore)();
    const invoiceRef = firestore.collection("invoices").doc(payload.invoiceId);
    const existing = await invoiceRef.get();
    if (existing.exists) {
        const current = existing.data() ?? {};
        if (!invoiceMatchesPayload(current, payload, userId)) {
            throw new https_1.HttpsError("already-exists", "Invoice id is already in use");
        }
        return { invoiceId: payload.invoiceId, status: current.status };
    }
    const projectReference = firestore.collection("projects").doc(payload.projectId);
    const projectBeforeProcessing = await projectReference.get();
    const initialProjectData = projectBeforeProcessing.data() ?? {};
    if (!projectBeforeProcessing.exists
        || initialProjectData.builderId !== userId
        || initialProjectData.ownerId !== userId) {
        throw new https_1.HttpsError("permission-denied", "The selected project does not belong to this builder");
    }
    const bucket = getInvoiceStorageBucket();
    const quarantineFile = bucket.file(payload.quarantinePath);
    let quarantineMetadata;
    let contents;
    try {
        [quarantineMetadata] = await quarantineFile.getMetadata();
        [contents] = await quarantineFile.download();
    }
    catch {
        throw new https_1.HttpsError("failed-precondition", "Invoice file was not found");
    }
    const quarantinedSize = Number(quarantineMetadata.size);
    const claimedContentType = String(quarantineMetadata.contentType ?? "").toLowerCase();
    const quarantineGeneration = String(quarantineMetadata.generation ?? "");
    if (!Number.isSafeInteger(quarantinedSize)
        || quarantinedSize <= 0
        || quarantinedSize >= invoice_file_js_1.MAX_INVOICE_FILE_BYTES
        || contents.length !== quarantinedSize
        || !quarantineGeneration) {
        throw new https_1.HttpsError("failed-precondition", "Invoice file metadata is invalid");
    }
    let sanitized;
    try {
        sanitized = await (0, invoice_file_js_1.sanitizeInvoiceFile)(contents, claimedContentType, payload.originalFileName);
    }
    catch {
        throw new https_1.HttpsError("invalid-argument", "Invoice file content is invalid");
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
    }
    catch {
        let existingFinalMetadata;
        try {
            [existingFinalMetadata] = await finalFile.getMetadata();
        }
        catch {
            throw new https_1.HttpsError("internal", "Invoice file could not be promoted");
        }
        if (existingFinalMetadata.metadata?.sourceGeneration !== quarantineGeneration) {
            throw new https_1.HttpsError("already-exists", "Invoice file id is already in use");
        }
    }
    let finalMetadata;
    try {
        [finalMetadata] = await finalFile.getMetadata();
    }
    catch {
        if (promotedByThisRequest)
            await finalFile.delete().catch(() => undefined);
        throw new https_1.HttpsError("internal", "Promoted invoice file could not be verified");
    }
    const fileSize = Number(finalMetadata.size);
    const fileGeneration = String(finalMetadata.generation ?? "");
    if (!Number.isSafeInteger(fileSize)
        || fileSize !== sanitized.bytes.length
        || finalMetadata.contentType !== sanitized.contentType
        || !fileGeneration) {
        if (promotedByThisRequest)
            await finalFile.delete().catch(() => undefined);
        throw new https_1.HttpsError("internal", "Promoted invoice file metadata is invalid");
    }
    let status;
    try {
        status = await firestore.runTransaction(async (transaction) => {
            const [invoiceSnapshot, projectSnapshot] = await Promise.all([
                transaction.get(invoiceRef),
                transaction.get(projectReference),
            ]);
            const projectData = projectSnapshot.data() ?? {};
            if (!projectSnapshot.exists
                || projectData.builderId !== userId
                || projectData.ownerId !== userId) {
                throw new https_1.HttpsError("permission-denied", "The selected project does not belong to this builder");
            }
            if (invoiceSnapshot.exists) {
                const current = invoiceSnapshot.data() ?? {};
                if (!invoiceMatchesPayload(current, payload, userId)) {
                    throw new https_1.HttpsError("already-exists", "Invoice id is already in use");
                }
                return current.status;
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
                status: "submitted",
                reviewedBy: null,
                reviewedAt: null,
                reviewNotes: null,
                createdAt: firestore_1.Timestamp.now(),
                updatedAt: firestore_1.Timestamp.now(),
            });
            return "submitted";
        });
    }
    catch (error) {
        if (promotedByThisRequest)
            await finalFile.delete().catch(() => undefined);
        throw error;
    }
    await quarantineFile.delete({ ifGenerationMatch: Number(quarantineGeneration) }).catch(() => {
        console.warn("Invoice quarantine cleanup deferred", { operation: "submitInvoice" });
    });
    return { invoiceId: payload.invoiceId, status };
});
const SPREADSHEET_CONTENT_TYPES = new Set([
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-excel",
    "text/csv",
    "text/tab-separated-values",
    "application/csv",
]);
const IMPORT_LOCK_TTL_MS = 10 * 60 * 1000;
exports.extractJobsFromExcel = (0, https_1.onCall)({ ...appCheckOptions, timeoutSeconds: 60, memory: "256MiB", maxInstances: 5 }, async (request) => {
    if (!request.auth) {
        throw new https_1.HttpsError("unauthenticated", "Authentication is required");
    }
    await requireCurrentRole(request.auth.uid, request.auth.token.role, request.auth.token.authorizationGrantId, request.auth.token.auth_time, ["admin", "manager"]);
    const managerId = request.auth.uid;
    await enforceRateLimit(managerId, "extractJobsFromExcel");
    const payload = getJobImportPayload(request.data, managerId);
    const firestore = (0, firestore_1.getFirestore)();
    const projectSnapshot = await firestore.collection("projects").doc(payload.projectId).get();
    if (!projectSnapshot.exists) {
        throw new https_1.HttpsError("not-found", "Project was not found");
    }
    const projectData = projectSnapshot.data() ?? {};
    const builderId = typeof projectData.builderId === "string"
        ? projectData.builderId.trim()
        : "";
    const ownerId = typeof projectData.ownerId === "string"
        ? projectData.ownerId.trim()
        : "";
    if (!builderId || ownerId !== builderId) {
        throw new https_1.HttpsError("failed-precondition", "The project builder assignment is inconsistent");
    }
    const file = getInvoiceStorageBucket().file(payload.filePath);
    let metadata;
    try {
        [metadata] = await file.getMetadata();
    }
    catch {
        throw new https_1.HttpsError("failed-precondition", "Spreadsheet file was not found");
    }
    const fileSize = Number(metadata.size);
    const contentType = String(metadata.contentType ?? "").toLowerCase();
    if (!Number.isSafeInteger(fileSize)
        || fileSize <= 0
        || fileSize > spreadsheet_js_1.MAX_SPREADSHEET_BYTES
        || !SPREADSHEET_CONTENT_TYPES.has(contentType)) {
        throw new https_1.HttpsError("invalid-argument", "Spreadsheet file metadata is invalid");
    }
    let contents;
    try {
        [contents] = await file.download();
    }
    catch {
        throw new https_1.HttpsError("failed-precondition", "Spreadsheet file could not be read");
    }
    if (contents.length !== fileSize || contents.length > spreadsheet_js_1.MAX_SPREADSHEET_BYTES) {
        throw new https_1.HttpsError("failed-precondition", "Spreadsheet file size is invalid");
    }
    let importedJobs;
    try {
        importedJobs = (0, spreadsheet_js_1.parseSpreadsheet)(contents, contentType, payload.fileName);
    }
    catch (error) {
        if (error instanceof spreadsheet_js_1.SpreadsheetParseError) {
            throw new https_1.HttpsError("invalid-argument", "Spreadsheet content is invalid");
        }
        throw new https_1.HttpsError("internal", "Spreadsheet could not be processed");
    }
    if (importedJobs.length === 0) {
        throw new https_1.HttpsError("invalid-argument", "Spreadsheet does not contain any jobs");
    }
    if (importedJobs.length > spreadsheet_js_1.MAX_SPREADSHEET_ROWS) {
        throw new https_1.HttpsError("invalid-argument", "Spreadsheet has too many jobs");
    }
    const importId = (0, node_crypto_1.createHash)("sha256")
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
                createdJobIds: data.createdJobIds.filter((id) => typeof id === "string"),
            };
        }
        const startedAt = data.startedAt instanceof firestore_1.Timestamp ? data.startedAt.toMillis() : 0;
        if (data.status === "processing" && startedAt > now - IMPORT_LOCK_TTL_MS) {
            throw new https_1.HttpsError("already-exists", "This spreadsheet import is already in progress");
        }
        transaction.set(importReference, {
            managerId,
            projectId: payload.projectId,
            filePath: payload.filePath,
            fileHash: (0, node_crypto_1.createHash)("sha256").update(contents).digest("hex"),
            status: "processing",
            rowCount: importedJobs.length,
            createdJobIds: [],
            startedAt: firestore_1.Timestamp.fromMillis(now),
            updatedAt: firestore_1.Timestamp.fromMillis(now),
        });
        return { completed: false, createdJobIds: [] };
    });
    if (claim.completed) {
        return { importId, createdJobIds: claim.createdJobIds };
    }
    claimed = true;
    try {
        const jobReferences = importedJobs.map((_, index) => firestore.collection("jobs").doc(`${importId}-${String(index + 1).padStart(3, "0")}`));
        const existingJobs = await firestore.getAll(...jobReferences);
        const batch = firestore.batch();
        const createdJobIds = [];
        existingJobs.forEach((snapshot, index) => {
            const reference = jobReferences[index];
            const importedJob = importedJobs[index];
            if (snapshot.exists) {
                const data = snapshot.data() ?? {};
                if (data.importId !== importId
                    || data.projectId !== payload.projectId
                    || data.builderId !== builderId
                    || data.title !== importedJob.title) {
                    throw new https_1.HttpsError("already-exists", "A generated job id is already in use");
                }
            }
            else {
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
                    createdAt: firestore_1.Timestamp.now(),
                    updatedAt: firestore_1.Timestamp.now(),
                });
            }
            createdJobIds.push(reference.id);
        });
        if (createdJobIds.length > 0 && existingJobs.some((snapshot) => !snapshot.exists)) {
            await batch.commit();
        }
        await importReference.set({
            status: "completed",
            createdJobIds,
            completedAt: firestore_1.Timestamp.now(),
            updatedAt: firestore_1.Timestamp.now(),
        }, { merge: true });
        return { importId, createdJobIds };
    }
    catch (error) {
        await importReference.set({
            status: "failed",
            failureCode: error instanceof https_1.HttpsError ? error.code : "internal",
            updatedAt: firestore_1.Timestamp.now(),
        }, { merge: true }).catch(() => undefined);
        if (error instanceof https_1.HttpsError)
            throw error;
        console.error("Spreadsheet job import failed", { operation: "extractJobsFromExcel" });
        throw new https_1.HttpsError("internal", "Spreadsheet import could not be completed");
    }
});
exports.reviewInvoice = (0, https_1.onCall)({ ...appCheckOptions, timeoutSeconds: 15, memory: "256MiB", maxInstances: 10 }, async (request) => {
    if (!request.auth) {
        throw new https_1.HttpsError("unauthenticated", "Authentication is required");
    }
    await requireCurrentRole(request.auth.uid, request.auth.token.role, request.auth.token.authorizationGrantId, request.auth.token.auth_time, ["admin", "manager"]);
    const managerId = request.auth.uid;
    await enforceRateLimit(managerId, "reviewInvoice");
    const payload = getReviewPayload(request.data);
    const invoiceRef = (0, firestore_1.getFirestore)().collection("invoices").doc(payload.invoiceId);
    const status = await (0, firestore_1.getFirestore)().runTransaction(async (transaction) => {
        const snapshot = await transaction.get(invoiceRef);
        if (!snapshot.exists)
            throw new https_1.HttpsError("not-found", "Invoice was not found");
        const current = snapshot.data() ?? {};
        if (current.status === payload.status &&
            current.reviewedBy === managerId &&
            current.reviewNotes === payload.reviewNotes) {
            return payload.status;
        }
        if (current.status !== "submitted") {
            throw new https_1.HttpsError("failed-precondition", "Invoice has already been reviewed");
        }
        transaction.update(invoiceRef, {
            status: payload.status,
            reviewedBy: managerId,
            reviewedAt: firestore_1.Timestamp.now(),
            reviewNotes: payload.reviewNotes,
            updatedAt: firestore_1.Timestamp.now(),
        });
        return payload.status;
    });
    return { invoiceId: payload.invoiceId, status };
});
const CLEANUP_BATCH_LIMIT = 100;
const RATE_LIMIT_RETENTION_MS = 24 * 60 * 60 * 1000;
const PROJECT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const hasProjectRecords = async (projectId) => {
    const firestore = (0, firestore_1.getFirestore)();
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
        if (!snapshot.empty)
            return true;
    }
    const [incomingSwitches, outgoingSwitches] = await Promise.all([
        firestore.collection("projectSwitches").where("toProjectId", "==", projectId).limit(1).get(),
        firestore.collection("projectSwitches").where("fromProjectId", "==", projectId).limit(1).get(),
    ]);
    return !incomingSwitches.empty || !outgoingSwitches.empty;
};
exports.cleanupOldProjects = (0, scheduler_1.onSchedule)({
    schedule: "every 24 hours",
    timeZone: "Etc/UTC",
    timeoutSeconds: 60,
    memory: "256MiB",
    maxInstances: 1,
    retryCount: 3,
}, async () => {
    const firestore = (0, firestore_1.getFirestore)();
    const now = Date.now();
    const controlRecordCutoff = now - RATE_LIMIT_RETENTION_MS;
    const staleInvitationSnapshot = await firestore
        .collection("invitations")
        .where("expiresAt", "<=", firestore_1.Timestamp.fromMillis(controlRecordCutoff))
        .limit(CLEANUP_BATCH_LIMIT)
        .get();
    const staleRateLimitSnapshot = await firestore
        .collection("functionRateLimits")
        .where("updatedAt", "<=", firestore_1.Timestamp.fromMillis(controlRecordCutoff))
        .limit(CLEANUP_BATCH_LIMIT)
        .get();
    let expiredInvitations = 0;
    let expiredInvitationTargets = 0;
    for (let offset = 0; offset < staleInvitationSnapshot.docs.length; offset += 10) {
        const outcomes = await Promise.all(staleInvitationSnapshot.docs.slice(offset, offset + 10).map((snapshot) => firestore.runTransaction(async (transaction) => {
            const current = await transaction.get(snapshot.ref);
            const data = current.data() ?? {};
            const expiresAt = data.expiresAt instanceof firestore_1.Timestamp ? data.expiresAt.toMillis() : 0;
            if (!current.exists || expiresAt <= 0 || expiresAt > controlRecordCutoff) {
                return { invitation: 0, target: 0 };
            }
            const targetLockId = typeof data.targetLockId === "string" ? data.targetLockId : "";
            const targetRef = /^[a-f0-9]{64}$/.test(targetLockId)
                ? firestore.collection("invitationTargets").doc(targetLockId)
                : null;
            const target = targetRef ? await transaction.get(targetRef) : null;
            const targetData = target?.data() ?? {};
            const targetExpiresAt = targetData.expiresAt instanceof firestore_1.Timestamp
                ? targetData.expiresAt.toMillis()
                : 0;
            transaction.delete(snapshot.ref);
            if (targetRef
                && target?.exists
                && targetData.invitationId === snapshot.id
                && targetExpiresAt > 0
                && targetExpiresAt <= controlRecordCutoff) {
                transaction.delete(targetRef);
                return { invitation: 1, target: 1 };
            }
            return { invitation: 1, target: 0 };
        })));
        expiredInvitations += outcomes.reduce((total, outcome) => total + outcome.invitation, 0);
        expiredInvitationTargets += outcomes.reduce((total, outcome) => total + outcome.target, 0);
    }
    const staleTargetSnapshot = await firestore
        .collection("invitationTargets")
        .where("expiresAt", "<=", firestore_1.Timestamp.fromMillis(controlRecordCutoff))
        .limit(CLEANUP_BATCH_LIMIT)
        .get();
    for (let offset = 0; offset < staleTargetSnapshot.docs.length; offset += 10) {
        const outcomes = await Promise.all(staleTargetSnapshot.docs.slice(offset, offset + 10).map((snapshot) => firestore.runTransaction(async (transaction) => {
            const target = await transaction.get(snapshot.ref);
            const data = target.data() ?? {};
            const expiresAt = data.expiresAt instanceof firestore_1.Timestamp ? data.expiresAt.toMillis() : 0;
            if (!target.exists || expiresAt <= 0 || expiresAt > controlRecordCutoff) {
                return { invitation: 0, target: 0 };
            }
            const invitationId = typeof data.invitationId === "string" ? data.invitationId : "";
            const invitationRef = invitationId
                ? firestore.collection("invitations").doc(invitationId)
                : null;
            const invitation = invitationRef ? await transaction.get(invitationRef) : null;
            const invitationData = invitation?.data() ?? {};
            const invitationExpiresAt = invitationData.expiresAt instanceof firestore_1.Timestamp
                ? invitationData.expiresAt.toMillis()
                : 0;
            if (invitation?.exists
                && invitationData.targetLockId === snapshot.id
                && invitationExpiresAt > controlRecordCutoff) {
                return { invitation: 0, target: 0 };
            }
            let deletedInvitation = 0;
            if (invitationRef
                && invitation?.exists
                && invitationData.targetLockId === snapshot.id
                && invitationExpiresAt > 0
                && invitationExpiresAt <= controlRecordCutoff) {
                transaction.delete(invitationRef);
                deletedInvitation = 1;
            }
            transaction.delete(snapshot.ref);
            return { invitation: deletedInvitation, target: 1 };
        })));
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
            const cleanupEligibleAt = data.cleanupEligibleAt instanceof firestore_1.Timestamp
                ? data.cleanupEligibleAt.toMillis()
                : 0;
            if (cleanupEligibleAt <= 0 || cleanupEligibleAt > retentionCutoff)
                continue;
            if (await hasProjectRecords(project.id))
                continue;
            await firestore.runTransaction(async (transaction) => {
                const current = await transaction.get(project.ref);
                const currentData = current.data() ?? {};
                const currentEligibleAt = currentData.cleanupEligibleAt instanceof firestore_1.Timestamp
                    ? currentData.cleanupEligibleAt.toMillis()
                    : 0;
                if (current.exists
                    && currentData.status === "finished"
                    && currentEligibleAt > 0
                    && currentEligibleAt <= retentionCutoff) {
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
});
