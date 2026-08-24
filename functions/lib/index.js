"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.consumeInvitation = exports.validateInvitationCode = exports.createManagerInvitation = exports.setUserRole = exports.ensureBuilderRole = void 0;
const node_crypto_1 = require("node:crypto");
const app_1 = require("firebase-admin/app");
const auth_1 = require("firebase-admin/auth");
const firestore_1 = require("firebase-admin/firestore");
const https_1 = require("firebase-functions/v2/https");
(0, app_1.initializeApp)();
const INVITATION_TTL_MS = 5 * 60 * 1000;
const INVITATION_CODE_LENGTH = 12;
const isAppRole = (value) => value === "manager" || value === "builder";
const isInvitationStatus = (value) => value === "pending" || value === "used";
const isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
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
