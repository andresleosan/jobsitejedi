"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const auth_session_js_1 = require("./auth-session.js");
const validAfter = "2026-08-31T05:00:00.000Z";
const validAfterSeconds = Date.parse(validAfter) / 1_000;
(0, node_test_1.default)("accepts only auth_time at or after tokensValidAfterTime", () => {
    strict_1.default.equal((0, auth_session_js_1.hasCurrentAuthSession)(validAfter, validAfterSeconds - 1), false);
    strict_1.default.equal((0, auth_session_js_1.hasCurrentAuthSession)(validAfter, validAfterSeconds), true);
    strict_1.default.equal((0, auth_session_js_1.hasCurrentAuthSession)(validAfter, validAfterSeconds + 1), true);
});
(0, node_test_1.default)("fails closed for missing, malformed, fractional, or non-positive session values", () => {
    strict_1.default.equal((0, auth_session_js_1.hasCurrentAuthSession)(undefined, validAfterSeconds), false);
    strict_1.default.equal((0, auth_session_js_1.hasCurrentAuthSession)("not-a-date", validAfterSeconds), false);
    strict_1.default.equal((0, auth_session_js_1.hasCurrentAuthSession)(validAfter, 0), false);
    strict_1.default.equal((0, auth_session_js_1.hasCurrentAuthSession)(validAfter, validAfterSeconds + 0.5), false);
    strict_1.default.equal((0, auth_session_js_1.hasCurrentAuthSession)(validAfter, String(validAfterSeconds)), false);
});
(0, node_test_1.default)("requires privileged invitation authentication within five minutes", () => {
    const now = 2_000_000_000;
    strict_1.default.equal((0, auth_session_js_1.hasRecentAuthentication)(now, now), true);
    strict_1.default.equal((0, auth_session_js_1.hasRecentAuthentication)(now - 300, now), true);
    strict_1.default.equal((0, auth_session_js_1.hasRecentAuthentication)(now - 301, now), false);
    strict_1.default.equal((0, auth_session_js_1.hasRecentAuthentication)(now + 1, now), false);
    strict_1.default.equal((0, auth_session_js_1.hasRecentAuthentication)("2000000000", now), false);
});
