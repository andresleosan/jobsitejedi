"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.cleanupOldProjects = exports.reviewInvoice = exports.extractJobsFromExcel = exports.submitInvoice = exports.createAssignedProject = exports.listAssignableBuilders = exports.consumeInvitation = exports.validateInvitationCode = exports.createManagerInvitation = void 0;
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
(0, v2_1.setGlobalOptions)({ region: "europe-west1" });
// Evaluated only while Firebase discovers the deployment manifest. The release
// command must opt in explicitly after the observation gate; absence is safe.
const ENFORCE_APP_CHECK = process.env.ENFORCE_APP_CHECK === "true";
const appCheckOptions = { enforceAppCheck: ENFORCE_APP_CHECK };
(0, app_1.initializeApp)();
const INVITATION_TTL_MS = 5 * 60 * 1000;
const INVITATION_CODE_LENGTH = 12;
const isAppRole = (value) => value === "admin" || value === "manager" || value === "builder";
const isManagementRole = (value) => value === "admin" || value === "manager";
const canInviteRole = (actorRole, targetRole) => actorRole === "admin" || targetRole === "builder";
const isInvitationStatus = (value) => value === "pending" || value === "used";
const isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
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
const createInvitationCode = () => (0, node_crypto_1.randomBytes)(INVITATION_CODE_LENGTH / 2).toString("hex").toUpperCase();
const invalidInvitation = () => ({
    valid: false,
    role: "builder",
    invitationId: "",
    errorMessage: "Invitation code is invalid or expired",
});
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
    consumeInvitation: { maxRequests: 5, windowMs: 15 * 60 * 1000 },
    listAssignableBuilders: { maxRequests: 30, windowMs: 60 * 1000 },
    createAssignedProject: { maxRequests: 20, windowMs: 60 * 1000 },
    extractJobsFromExcel: { maxRequests: 5, windowMs: 60 * 60 * 1000 },
    submitInvoice: { maxRequests: 10, windowMs: 10 * 60 * 1000 },
    reviewInvoice: { maxRequests: 30, windowMs: 60 * 1000 },
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
const assignClaimsOrCompensate = async (userId, claims, invitationReference) => {
    try {
        await (0, auth_1.getAuth)().setCustomUserClaims(userId, claims);
    }
    catch {
        if (invitationReference) {
            try {
                await (0, firestore_1.getFirestore)().runTransaction(async (transaction) => {
                    const snapshot = await transaction.get(invitationReference);
                    const data = snapshot.data() ?? {};
                    if (snapshot.exists && data.status === "used" && data.usedBy === userId) {
                        transaction.update(invitationReference, {
                            status: "pending",
                            usedBy: null,
                            usedAt: null,
                        });
                    }
                });
            }
            catch {
                console.error("Role assignment compensation failed", {
                    operation: "consumeInvitation",
                });
            }
        }
        throw new https_1.HttpsError("internal", "Unable to assign the account role; please retry");
    }
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
exports.createManagerInvitation = (0, https_1.onCall)(appCheckOptions, async (request) => {
    const actorRole = request.auth?.token.role;
    if (!request.auth || !isManagementRole(actorRole)) {
        throw new https_1.HttpsError("permission-denied", "Admin or manager role is required");
    }
    if (!isRecord(request.data) || !isAppRole(request.data.role)) {
        throw new https_1.HttpsError("invalid-argument", "A valid invitation role is required");
    }
    if (!canInviteRole(actorRole, request.data.role)) {
        throw new https_1.HttpsError("permission-denied", "Only admins can invite admins or managers");
    }
    await enforceRateLimit(request.auth.uid, "createManagerInvitation");
    const code = createInvitationCode();
    const expiresAt = firestore_1.Timestamp.fromMillis(Date.now() + INVITATION_TTL_MS);
    await (0, firestore_1.getFirestore)().collection("invitations").add({
        codeHash: hashInvitationCode(code),
        role: request.data.role,
        status: "pending",
        createdBy: request.auth.uid,
        createdByRole: actorRole,
        createdAt: firestore_1.Timestamp.now(),
        expiresAt,
        usedBy: null,
        usedAt: null,
    });
    return { code, expiresAt: expiresAt.toDate().toISOString() };
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
    const code = normalizeInvitationCode(isRecord(request.data) ? request.data.code : request.data);
    if (!code)
        return invalidInvitation();
    const snapshot = await (0, firestore_1.getFirestore)()
        .collection("invitations")
        .where("codeHash", "==", hashInvitationCode(code))
        .limit(1)
        .get();
    if (snapshot.empty)
        return invalidInvitation();
    const invitation = snapshot.docs[0];
    const data = invitation.data();
    const expiresAt = data.expiresAt instanceof firestore_1.Timestamp ? data.expiresAt.toMillis() : 0;
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
exports.consumeInvitation = (0, https_1.onCall)(appCheckOptions, async (request) => {
    if (!request.auth) {
        throw new https_1.HttpsError("unauthenticated", "Authentication is required");
    }
    if (!isRecord(request.data) || typeof request.data.invitationId !== "string" || !request.data.invitationId.trim()) {
        throw new https_1.HttpsError("invalid-argument", "A valid invitationId is required");
    }
    const auth = (0, auth_1.getAuth)();
    const firestore = (0, firestore_1.getFirestore)();
    const userId = request.auth.uid;
    const invitationRef = firestore.collection("invitations").doc(request.data.invitationId.trim());
    await enforceRateLimit(userId, "consumeInvitation");
    const user = await getUserWithRetry(userId);
    const currentRole = user.customClaims?.role;
    let alreadyConsumed = false;
    const role = await firestore.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(invitationRef);
        if (!snapshot.exists)
            throw new https_1.HttpsError("not-found", "Invitation was not found");
        const data = snapshot.data() ?? {};
        const expiresAt = data.expiresAt instanceof firestore_1.Timestamp ? data.expiresAt.toMillis() : 0;
        if (!isAppRole(data.role) || !isInvitationStatus(data.status) || expiresAt <= Date.now()) {
            throw new https_1.HttpsError("failed-precondition", "Invitation is invalid or expired");
        }
        if (data.status === "used" && data.usedBy === userId && currentRole === data.role) {
            alreadyConsumed = true;
            return data.role;
        }
        if (data.status !== "pending") {
            throw new https_1.HttpsError("failed-precondition", "Invitation is invalid or expired");
        }
        if (currentRole && currentRole !== data.role) {
            throw new https_1.HttpsError("permission-denied", "The invitation role conflicts with the current account");
        }
        transaction.update(invitationRef, {
            status: "used",
            usedBy: userId,
            usedAt: firestore_1.Timestamp.now(),
        });
        return data.role;
    });
    if (!alreadyConsumed) {
        await assignClaimsOrCompensate(userId, { ...user.customClaims, role }, invitationRef);
    }
    return { role };
});
exports.listAssignableBuilders = (0, https_1.onCall)({ ...appCheckOptions, timeoutSeconds: 15, memory: "256MiB", maxInstances: 10 }, async (request) => {
    if (!request.auth) {
        throw new https_1.HttpsError("unauthenticated", "Authentication is required");
    }
    if (!isManagementRole(request.auth.token.role)) {
        throw new https_1.HttpsError("permission-denied", "Admin or manager role is required");
    }
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
    if (!isManagementRole(request.auth.token.role)) {
        throw new https_1.HttpsError("permission-denied", "Admin or manager role is required");
    }
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
    if (request.auth.token.role !== "builder") {
        throw new https_1.HttpsError("permission-denied", "Builder role is required");
    }
    const userId = request.auth.uid;
    await enforceRateLimit(userId, "submitInvoice");
    const uploadedByName = typeof request.auth.token.name === "string"
        ? request.auth.token.name
        : null;
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
    if (!request.auth || !isManagementRole(request.auth.token.role)) {
        throw new https_1.HttpsError("permission-denied", "Admin or manager role is required");
    }
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
    if (!request.auth || !isManagementRole(request.auth.token.role)) {
        throw new https_1.HttpsError("permission-denied", "Admin or manager role is required");
    }
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
    const staleInvitationSnapshot = await firestore
        .collection("invitations")
        .where("expiresAt", "<=", firestore_1.Timestamp.fromMillis(now - RATE_LIMIT_RETENTION_MS))
        .limit(CLEANUP_BATCH_LIMIT)
        .get();
    const staleRateLimitSnapshot = await firestore
        .collection("functionRateLimits")
        .where("updatedAt", "<=", firestore_1.Timestamp.fromMillis(now - RATE_LIMIT_RETENTION_MS))
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
        expiredInvitations: staleInvitationSnapshot.size,
        staleRateLimits: staleRateLimitSnapshot.size,
        deletedProjects,
    });
});
