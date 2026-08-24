import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { HttpsError, onCall } from "firebase-functions/v2/https";

initializeApp();

type AppRole = "manager" | "builder";

const isAppRole = (value: unknown): value is AppRole =>
  value === "manager" || value === "builder";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const getRolePayload = (value: unknown): { userId: string; role: AppRole } => {
  if (!isRecord(value) || typeof value.userId !== "string" || !isAppRole(value.role)) {
    throw new HttpsError("invalid-argument", "A valid userId and role are required");
  }

  const userId = value.userId.trim();
  if (!userId) {
    throw new HttpsError("invalid-argument", "A valid userId and role are required");
  }

  return { userId, role: value.role };
};

const wait = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

const getUserWithRetry = async (userId: string) => {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      return await getAuth().getUser(userId);
    } catch (error) {
      if (
        typeof error !== "object" ||
        error === null ||
        !("code" in error) ||
        error.code !== "auth/user-not-found" ||
        attempt === 4
      ) {
        throw new HttpsError("internal", "Unable to load the authenticated user");
      }

      await wait(50 * (attempt + 1));
    }
  }

  throw new HttpsError("internal", "Unable to load the authenticated user");
};

export const ensureBuilderRole = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication is required");
  }

  if (!isRecord(request.data) || request.data.role !== "builder") {
    throw new HttpsError("invalid-argument", "Only the builder role can be self-assigned");
  }

  const auth = getAuth();
  const user = await getUserWithRetry(request.auth.uid);
  const currentRole = user.customClaims?.role;

  if (currentRole !== undefined && currentRole !== "builder") {
    throw new HttpsError("permission-denied", "The current role cannot be changed this way");
  }

  await auth.setCustomUserClaims(request.auth.uid, {
    ...user.customClaims,
    role: "builder",
  });

  return { role: "builder" as const };
});

export const setUserRole = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication is required");
  }

  if (request.auth.token.role !== "manager") {
    throw new HttpsError("permission-denied", "Manager role is required");
  }

  const { userId, role } = getRolePayload(request.data);
  const auth = getAuth();
  const user = await getUserWithRetry(userId);

  await auth.setCustomUserClaims(userId, {
    ...user.customClaims,
    role,
  });

  return { userId, role };
});
