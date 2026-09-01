"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const access_requests_js_1 = require("./access-requests.js");
(0, node_test_1.default)("normalizes a valid access request without accepting a client role claim", () => {
    strict_1.default.deepEqual((0, access_requests_js_1.normalizeAccessRequestInput)({
        requestedRole: " manager ",
        fullName: "  New Manager  ",
        phone: " +57 300 123 4567 ",
    }), {
        requestedRole: "manager",
        fullName: "New Manager",
        phone: "+57 300 123 4567",
    });
});
(0, node_test_1.default)("rejects malformed access requests and unsupported roles", () => {
    strict_1.default.throws(() => (0, access_requests_js_1.normalizeAccessRequestInput)({ requestedRole: "owner", fullName: "Someone" }), /requested role/i);
    strict_1.default.throws(() => (0, access_requests_js_1.normalizeAccessRequestInput)({ requestedRole: "builder", fullName: "" }), /full name/i);
    strict_1.default.throws(() => (0, access_requests_js_1.normalizeAccessRequestInput)({ requestedRole: "admin", fullName: "Someone", phone: "x".repeat(21) }), /phone/i);
});
(0, node_test_1.default)("accepts only approve or reject review decisions", () => {
    strict_1.default.deepEqual((0, access_requests_js_1.normalizeAccessRequestReviewInput)({ requestId: "user-12345", decision: "approve" }), { requestId: "user-12345", decision: "approve", reason: null });
    strict_1.default.deepEqual((0, access_requests_js_1.normalizeAccessRequestReviewInput)({ requestId: "user-12345", decision: "reject", reason: "  Not enough detail  " }), { requestId: "user-12345", decision: "reject", reason: "Not enough detail" });
    strict_1.default.throws(() => (0, access_requests_js_1.normalizeAccessRequestReviewInput)({ requestId: "", decision: "approve" }), /request id/i);
    strict_1.default.throws(() => (0, access_requests_js_1.normalizeAccessRequestReviewInput)({ requestId: "user-12345", decision: "pending" }), /decision/i);
});
(0, node_test_1.default)("keeps the role contract limited to the three application roles", () => {
    const roles = ["admin", "manager", "builder"];
    strict_1.default.deepEqual(roles, ["admin", "manager", "builder"]);
});
