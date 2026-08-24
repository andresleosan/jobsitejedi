"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.setUserRole = exports.ensureBuilderRole = void 0;
const app_1 = require("firebase-admin/app");
const auth_1 = require("firebase-admin/auth");
const https_1 = require("firebase-functions/v2/https");
(0, app_1.initializeApp)();
const isAppRole = (value) => value === "manager" || value === "builder";
const isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
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
