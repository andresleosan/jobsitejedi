const PRIVILEGED_INVITATION_AUTH_MAX_AGE_SECONDS = 5 * 60;

export const hasCurrentAuthSession = (
  tokensValidAfterTime: string | undefined,
  tokenAuthTime: unknown,
): boolean => {
  const authTimeSeconds = typeof tokenAuthTime === "number" && Number.isSafeInteger(tokenAuthTime)
    ? tokenAuthTime
    : 0;
  const tokensValidAfterSeconds = Math.floor(Date.parse(tokensValidAfterTime ?? "") / 1_000);
  return authTimeSeconds > 0
    && Number.isFinite(tokensValidAfterSeconds)
    && authTimeSeconds >= tokensValidAfterSeconds;
};

export const hasRecentAuthentication = (
  tokenAuthTime: unknown,
  nowSeconds = Math.floor(Date.now() / 1_000),
): boolean => {
  if (
    typeof tokenAuthTime !== "number"
    || !Number.isSafeInteger(tokenAuthTime)
    || !Number.isSafeInteger(nowSeconds)
  ) {
    return false;
  }
  const ageSeconds = nowSeconds - tokenAuthTime;
  return ageSeconds >= 0 && ageSeconds <= PRIVILEGED_INVITATION_AUTH_MAX_AGE_SECONDS;
};
