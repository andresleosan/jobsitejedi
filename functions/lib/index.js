"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.reviewInvoice = exports.submitInvoice = exports.consumeInvitation = exports.validateInvitationCode = exports.createManagerInvitation = exports.setUserRole = exports.ensureBuilderRole = void 0;
const node_crypto_1 = require("node:crypto");
const app_1 = require("firebase-admin/app");
const auth_1 = require("firebase-admin/auth");
const firestore_1 = require("firebase-admin/firestore");
const storage_1 = require("firebase-admin/storage");
const https_1 = require("firebase-functions/v2/https");
(0, app_1.initializeApp)();
const INVITATION_TTL_MS = 5 * 60 * 1000;
const INVITATION_CODE_LENGTH = 12;
const isAppRole = (value) => value === "manager" || value === "builder";
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
    const fileName = requireText(value.fileName, "Invoice file name", 180);
    const filePath = requireText(value.filePath, "Invoice file path", 500);
    const expectedPrefix = `invoices/${userId}/${invoiceId}/`;
    if (!filePath.startsWith(expectedPrefix) ||
        filePath.slice(expectedPrefix.length).includes("/") ||
        !/^[A-Za-z0-9._-]+$/.test(filePath.slice(expectedPrefix.length))) {
        throw new https_1.HttpsError("invalid-argument", "Invoice file path is invalid");
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
const invoiceMatchesPayload = (current, payload, userId) => current.uploadedBy === userId &&
    current.projectId === payload.projectId &&
    current.invoiceNumber === payload.invoiceNumber &&
    current.supplierName === payload.supplierName &&
    current.invoiceDate === payload.invoiceDate &&
    current.totalAmountMinor === payload.totalAmountMinor &&
    current.currency === payload.currency &&
    current.notes === payload.notes &&
    current.filePath === payload.filePath &&
    current.fileName === payload.fileName;
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
const getRolePayload = (value) => {
    if (!isRecord(value) || typeof value.userId !== "string" || !isAppRole(value.role)) {
        throw new https_1.HttpsError("invalid-argument", "A valid userId and role are required");
    }
    const userId = value.userId.trim();
    if (!userId) {
        throw new https_1.HttpsError("invalid-argument", "A valid userId and role are required");
    }
    return { userId, role: value.role };
};
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
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
exports.ensureBuilderRole = (0, https_1.onCall)(async (request) => {
    if (!request.auth) {
        throw new https_1.HttpsError("unauthenticated", "Authentication is required");
    }
    if (!isRecord(request.data) || request.data.role !== "builder") {
        throw new https_1.HttpsError("invalid-argument", "Only the builder role can be self-assigned");
    }
    const auth = (0, auth_1.getAuth)();
    const user = await getUserWithRetry(request.auth.uid);
    const currentRole = user.customClaims?.role;
    if (currentRole !== undefined && currentRole !== "builder") {
        throw new https_1.HttpsError("permission-denied", "The current role cannot be changed this way");
    }
    await auth.setCustomUserClaims(request.auth.uid, {
        ...user.customClaims,
        role: "builder",
    });
    return { role: "builder" };
});
exports.setUserRole = (0, https_1.onCall)(async (request) => {
    if (!request.auth) {
        throw new https_1.HttpsError("unauthenticated", "Authentication is required");
    }
    if (request.auth.token.role !== "manager") {
        throw new https_1.HttpsError("permission-denied", "Manager role is required");
    }
    const { userId, role } = getRolePayload(request.data);
    const auth = (0, auth_1.getAuth)();
    const user = await getUserWithRetry(userId);
    await auth.setCustomUserClaims(userId, {
        ...user.customClaims,
        role,
    });
    return { userId, role };
});
exports.createManagerInvitation = (0, https_1.onCall)(async (request) => {
    if (!request.auth || request.auth.token.role !== "manager") {
        throw new https_1.HttpsError("permission-denied", "Manager role is required");
    }
    if (!isRecord(request.data) || !isAppRole(request.data.role)) {
        throw new https_1.HttpsError("invalid-argument", "A valid invitation role is required");
    }
    const code = createInvitationCode();
    const expiresAt = firestore_1.Timestamp.fromMillis(Date.now() + INVITATION_TTL_MS);
    await (0, firestore_1.getFirestore)().collection("invitations").add({
        codeHash: hashInvitationCode(code),
        role: request.data.role,
        status: "pending",
        createdBy: request.auth.uid,
        createdAt: firestore_1.Timestamp.now(),
        expiresAt,
        usedBy: null,
        usedAt: null,
    });
    return { code, expiresAt: expiresAt.toDate().toISOString() };
});
exports.validateInvitationCode = (0, https_1.onCall)(async (request) => {
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
exports.consumeInvitation = (0, https_1.onCall)(async (request) => {
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
    const user = await getUserWithRetry(userId);
    const currentRole = user.customClaims?.role;
    const role = await firestore.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(invitationRef);
        if (!snapshot.exists)
            throw new https_1.HttpsError("not-found", "Invitation was not found");
        const data = snapshot.data() ?? {};
        const expiresAt = data.expiresAt instanceof firestore_1.Timestamp ? data.expiresAt.toMillis() : 0;
        if (!isAppRole(data.role) || !isInvitationStatus(data.status) || data.status !== "pending" || expiresAt <= Date.now()) {
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
    await auth.setCustomUserClaims(userId, {
        ...user.customClaims,
        role,
    });
    return { role };
});
exports.submitInvoice = (0, https_1.onCall)({ timeoutSeconds: 30, memory: "256MiB", maxInstances: 10 }, async (request) => {
    if (!request.auth) {
        throw new https_1.HttpsError("unauthenticated", "Authentication is required");
    }
    if (request.auth.token.role !== "builder") {
        throw new https_1.HttpsError("permission-denied", "Builder role is required");
    }
    const userId = request.auth.uid;
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
    let metadata;
    try {
        [metadata] = await getInvoiceStorageBucket().file(payload.filePath).getMetadata();
    }
    catch {
        throw new https_1.HttpsError("failed-precondition", "Invoice file was not found");
    }
    const fileSize = Number(metadata.size);
    const contentType = metadata.contentType ?? "";
    const fileGeneration = String(metadata.generation ?? "");
    if (!Number.isSafeInteger(fileSize) ||
        fileSize <= 0 ||
        fileSize >= 10 * 1024 * 1024 ||
        !(contentType === "application/pdf" || contentType.startsWith("image/")) ||
        !fileGeneration) {
        throw new https_1.HttpsError("failed-precondition", "Invoice file metadata is invalid");
    }
    const status = await firestore.runTransaction(async (transaction) => {
        const [invoiceSnapshot, projectSnapshot] = await Promise.all([
            transaction.get(invoiceRef),
            transaction.get(firestore.collection("projects").doc(payload.projectId)),
        ]);
        if (!projectSnapshot.exists || projectSnapshot.data()?.ownerId !== userId) {
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
            status: "submitted",
            reviewedBy: null,
            reviewedAt: null,
            reviewNotes: null,
            createdAt: firestore_1.Timestamp.now(),
            updatedAt: firestore_1.Timestamp.now(),
        });
        return "submitted";
    });
    return { invoiceId: payload.invoiceId, status };
});
exports.reviewInvoice = (0, https_1.onCall)({ timeoutSeconds: 15, memory: "256MiB", maxInstances: 10 }, async (request) => {
    if (!request.auth || request.auth.token.role !== "manager") {
        throw new https_1.HttpsError("permission-denied", "Manager role is required");
    }
    const managerId = request.auth.uid;
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
