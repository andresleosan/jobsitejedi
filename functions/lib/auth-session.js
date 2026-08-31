"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.hasRecentAuthentication = exports.hasCurrentAuthSession = void 0;
const PRIVILEGED_INVITATION_AUTH_MAX_AGE_SECONDS = 5 * 60;
const hasCurrentAuthSession = (tokensValidAfterTime, tokenAuthTime) => {
    const authTimeSeconds = typeof tokenAuthTime === "number" && Number.isSafeInteger(tokenAuthTime)
        ? tokenAuthTime
        : 0;
    const tokensValidAfterSeconds = Math.floor(Date.parse(tokensValidAfterTime ?? "") / 1_000);
    return authTimeSeconds > 0
        && Number.isFinite(tokensValidAfterSeconds)
        && authTimeSeconds >= tokensValidAfterSeconds;
};
exports.hasCurrentAuthSession = hasCurrentAuthSession;
const hasRecentAuthentication = (tokenAuthTime, nowSeconds = Math.floor(Date.now() / 1_000)) => {
    if (typeof tokenAuthTime !== "number"
        || !Number.isSafeInteger(tokenAuthTime)
        || !Number.isSafeInteger(nowSeconds)) {
        return false;
    }
    const ageSeconds = nowSeconds - tokenAuthTime;
    return ageSeconds >= 0 && ageSeconds <= PRIVILEGED_INVITATION_AUTH_MAX_AGE_SECONDS;
};
exports.hasRecentAuthentication = hasRecentAuthentication;
