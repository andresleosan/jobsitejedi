import {
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  onIdTokenChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut as firebaseSignOut,
  updateProfile,
  type User,
} from "firebase/auth";
import { firebaseAuth } from "./client";
import { accessRequestOperations, invitationOperations } from "./functions";
import { isAppRole, type AppRole, type SessionUser } from "./types";

export const MISSING_ROLE_MESSAGE =
  "This account has no assigned BuildTrack role. Contact an administrator";

const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: "select_account" });

class AuthAdapterError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "AuthAdapterError";
  }
}

const getErrorCode = (error: unknown) => {
  if (typeof error === "object" && error !== null && "code" in error) {
    return String(error.code);
  }

  return "";
};

export const normalizeAuthError = (error: unknown): Error => {
  switch (getErrorCode(error)) {
    case "auth/invalid-credential":
    case "auth/invalid-login-credentials":
    case "auth/user-not-found":
    case "auth/wrong-password":
      return new Error("Invalid email or password");
    case "auth/email-already-in-use":
      return new Error("An account already exists for this email");
    case "auth/invalid-email":
      return new Error("Please enter a valid email address");
    case "auth/weak-password":
      return new Error("Password does not meet the minimum requirements");
    case "auth/network-request-failed":
      return new Error("Unable to connect to authentication service");
    case "auth/too-many-requests":
      return new Error("Too many attempts. Please try again later");
    case "auth/popup-closed-by-user":
    case "auth/cancelled-popup-request":
      return new Error("Google sign-in was cancelled");
    case "auth/popup-blocked":
      return new Error("Allow pop-ups in your browser to continue with Google");
    case "auth/account-exists-with-different-credential":
      return new Error("This email already uses another sign-in method");
    case "auth/operation-not-allowed":
      return new Error("Google sign-in is not enabled for this application");
    case "auth/unauthorized-domain":
      return new Error("This domain is not authorized for Google sign-in");
    case "auth/user-disabled":
      return new Error("This account has been disabled");
    case "app/missing-role":
      return new Error(MISSING_ROLE_MESSAGE);
    case "app/invalid-invitation":
      return new Error("Invitation is invalid, expired, or does not match this email");
    case "functions/permission-denied":
      return new Error("You do not have permission to perform this action");
    case "functions/unauthenticated":
      return new Error("Your authentication session has expired");
    case "functions/invalid-argument":
      return new Error("Invalid request");
    case "functions/failed-precondition":
    case "functions/not-found":
      return new Error("Invitation is invalid, expired, or does not match this email");
    case "functions/already-exists":
      return new Error("You already have a pending access request");
    default:
      return new Error("Authentication failed. Please try again");
  }
};

const getRoleFromClaims = async (user: User): Promise<AppRole | null> => {
  const token = await user.getIdTokenResult();
  const grantId = token.claims.authorizationGrantId;
  return isAppRole(token.claims.role)
    && typeof grantId === "string"
    && /^[a-f0-9]{32}$/.test(grantId)
    ? token.claims.role
    : null;
};

const toSessionUser = async (user: User): Promise<SessionUser> => ({
  id: user.uid,
  email: user.email ?? "",
  fullName: user.displayName ?? "",
  role: await getRoleFromClaims(user),
});

const toAuthorizedSessionUser = async (user: User): Promise<SessionUser> => {
  const sessionUser = await toSessionUser(user);
  if (sessionUser.role) return sessionUser;

  await firebaseSignOut(firebaseAuth).catch(() => undefined);
  throw new AuthAdapterError(
    "app/missing-role",
    "Authenticated identity has no current application authorization",
  );
};

const validateRegistrationInput = (input: {
  email: string;
  password: string;
  fullName: string;
}) => {
  if (
    typeof input.email !== "string" ||
    typeof input.password !== "string" ||
    typeof input.fullName !== "string" ||
    !input.email.trim() ||
    !input.password ||
    !input.fullName.trim()
  ) {
    throw new Error("Registration details are required");
  }
};

export const signIn = async (
  email: string,
  password: string,
): Promise<SessionUser> => {
  if (
    typeof email !== "string" ||
    typeof password !== "string" ||
    !email.trim() ||
    !password
  ) {
    throw new Error("Email and password are required");
  }

  try {
    const credential = await signInWithEmailAndPassword(
      firebaseAuth,
      email.trim().toLowerCase(),
      password,
    );
    return await toSessionUser(credential.user);
  } catch (error) {
    throw normalizeAuthError(error);
  }
};

export const signInWithGoogle = async (): Promise<SessionUser> => {
  try {
    const credential = await signInWithPopup(firebaseAuth, googleProvider);
    return await toSessionUser(credential.user);
  } catch (error) {
    throw normalizeAuthError(error);
  }
};

export const registerWithInvitation = async (input: {
  email: string;
  password: string;
  fullName: string;
  invitationCode: string;
}): Promise<{ status: "complete"; user: SessionUser }> => {
  validateRegistrationInput(input);
  if (!input.invitationCode.trim()) throw new Error("Invitation is required");

  try {
    const { normalizedEmail, normalizedCode } = validateInvitationIdentity(input);
    const invitation = await invitationOperations.validateInvitationCode(
      normalizedCode,
      normalizedEmail,
    );
    if (!invitation.valid) {
      throw new AuthAdapterError(
        "app/invalid-invitation",
        "Invitation validation failed for the requested account",
      );
    }

    if (firebaseAuth.currentUser) {
      await firebaseSignOut(firebaseAuth);
    }
    await invitationOperations.activateInvitation({
      code: normalizedCode,
      targetEmail: normalizedEmail,
      password: input.password,
      fullName: input.fullName,
    });
    const registrationUser = (
      await signInWithEmailAndPassword(firebaseAuth, normalizedEmail, input.password)
    ).user;

    const enrollmentToken = await registrationUser.getIdTokenResult(true);
    if (
      typeof enrollmentToken.claims.invitationEnrollmentId !== "string"
      || !/^[a-f0-9]{32}$/.test(enrollmentToken.claims.invitationEnrollmentId)
    ) {
      await firebaseSignOut(firebaseAuth).catch(() => undefined);
      throw new AuthAdapterError(
        "app/invalid-invitation",
        "The account was not created by the secure invitation enrollment flow",
      );
    }

    await invitationOperations.consumeInvitation({ code: normalizedCode });
    await registrationUser.getIdToken(true);
    return { status: "complete", user: await toAuthorizedSessionUser(registrationUser) };
  } catch (error) {
    throw normalizeAuthError(error);
  }
};

export const registerForAccess = async (input: {
  email: string;
  password: string;
  fullName: string;
  phone?: string | null;
  requestedRole: AppRole;
}): Promise<{ status: "pending" | "approving"; requestedRole: AppRole }> => {
  validateRegistrationInput(input);
  if (!isAppRole(input.requestedRole)) throw new Error("A valid role is required");

  const normalizedEmail = input.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
    throw new Error("Please enter a valid email address");
  }

  try {
    if (firebaseAuth.currentUser) await firebaseSignOut(firebaseAuth);
    const credential = await createUserWithEmailAndPassword(
      firebaseAuth,
      normalizedEmail,
      input.password,
    );
    await updateProfile(credential.user, { displayName: input.fullName.trim() });
    const result = await accessRequestOperations.submitAccessRequest({
      requestedRole: input.requestedRole,
      fullName: input.fullName.trim(),
      phone: input.phone?.trim() || null,
    });
    await firebaseSignOut(firebaseAuth);
    return result;
  } catch (error) {
    await firebaseSignOut(firebaseAuth).catch(() => undefined);
    throw normalizeAuthError(error);
  }
};

export const submitAccessRequest = async (input: {
  requestedRole: AppRole;
  fullName: string;
  phone?: string | null;
}) => {
  if (!firebaseAuth.currentUser) throw new Error("Sign in before requesting access");
  try {
    const result = await accessRequestOperations.submitAccessRequest(input);
    await firebaseSignOut(firebaseAuth);
    return result;
  } catch (error) {
    throw normalizeAuthError(error);
  }
};

const validateInvitationIdentity = (input: {
  email: string;
  invitationCode: string;
}) => {
  const normalizedEmail = input.email.trim().toLowerCase();
  const normalizedCode = input.invitationCode.trim().toUpperCase();
  if (
    !normalizedEmail
    || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)
    || !/^[A-Z0-9]{12}$/.test(normalizedCode)
  ) {
    throw new AuthAdapterError(
      "app/invalid-invitation",
      "Invitation identity is invalid",
    );
  }
  return { normalizedEmail, normalizedCode };
};

export const signOut = async (): Promise<void> => {
  try {
    await firebaseSignOut(firebaseAuth);
  } catch (error) {
    throw normalizeAuthError(error);
  }
};

export const subscribeToAuth = (
  listener: (user: SessionUser | null) => void,
): (() => void) => {
  let latestEvent = 0;
  const unsubscribe = onIdTokenChanged(firebaseAuth, (user) => {
    const event = ++latestEvent;
    void (user ? toSessionUser(user) : Promise.resolve(null))
      .then((nextUser) => {
        if (event === latestEvent) listener(nextUser);
      })
      .catch(() => {
        if (event === latestEvent) listener(null);
      });
  });

  return unsubscribe;
};

export const getCurrentRole = async (): Promise<AppRole | null> => {
  const user = firebaseAuth.currentUser;
  if (!user) return null;

  try {
    return await getRoleFromClaims(user);
  } catch (error) {
    throw normalizeAuthError(error);
  }
};
