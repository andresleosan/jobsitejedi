"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeAccessRequestReviewInput = exports.normalizeAccessRequestInput = exports.ACCESS_REQUEST_SCHEMA_VERSION = void 0;
exports.ACCESS_REQUEST_SCHEMA_VERSION = 1;
const isAccessRequestRole = (value) => value === "admin" || value === "manager" || value === "builder";
const requireText = (value, label, maximumLength) => {
    if (typeof value !== "string")
        throw new Error(`${label} is required`);
    const normalized = value.trim();
    if (!normalized
        || normalized.length > maximumLength
        || [...normalized].some((character) => {
            const codePoint = character.codePointAt(0) ?? 0;
            return codePoint < 32 || codePoint === 127;
        })) {
        throw new Error(`${label} is invalid`);
    }
    return normalized;
};
const normalizeAccessRequestInput = (value) => {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        throw new Error("Access request details are required");
    }
    const payload = value;
    const requestedRole = typeof payload.requestedRole === "string"
        ? payload.requestedRole.trim().toLowerCase()
        : "";
    if (!isAccessRequestRole(requestedRole)) {
        throw new Error("A valid requested role is required");
    }
    const fullName = requireText(payload.fullName, "Full name", 100);
    const phone = payload.phone == null || payload.phone === ""
        ? null
        : requireText(payload.phone, "Phone", 20);
    if (phone && !/^(\+?[0-9\s\-()]+)$/.test(phone)) {
        throw new Error("Phone is invalid");
    }
    return { requestedRole, fullName, phone };
};
exports.normalizeAccessRequestInput = normalizeAccessRequestInput;
const normalizeAccessRequestReviewInput = (value) => {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        throw new Error("Access request review details are required");
    }
    const payload = value;
    const requestId = requireText(payload.requestId, "Request id", 128);
    if (!/^[A-Za-z0-9_-]{10,128}$/.test(requestId)) {
        throw new Error("Request id is invalid");
    }
    if (payload.decision !== "approve" && payload.decision !== "reject") {
        throw new Error("Review decision is invalid");
    }
    const reason = payload.reason == null || payload.reason === ""
        ? null
        : requireText(payload.reason, "Review reason", 500);
    const approvedRole = payload.approvedRole == null || payload.approvedRole === ""
        ? null
        : typeof payload.approvedRole === "string"
            ? payload.approvedRole.trim().toLowerCase()
            : null;
    if (approvedRole !== null && !isAccessRequestRole(approvedRole)) {
        throw new Error("A valid approved role is required");
    }
    if (payload.decision === "approve" && approvedRole === null) {
        throw new Error("A valid approved role is required");
    }
    if (payload.decision === "reject" && reason === null) {
        throw new Error("A rejection reason is required");
    }
    return { requestId, decision: payload.decision, reason, approvedRole };
};
exports.normalizeAccessRequestReviewInput = normalizeAccessRequestReviewInput;
