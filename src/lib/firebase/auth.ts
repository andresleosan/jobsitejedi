import {
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  onIdTokenChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut as firebaseSignOut,
  updateProfile,
  type User,
} from "firebase/auth";
import { firebaseAuth } from "./client";
import { ensureBuilderRole, invitationOperations } from "./functions";
import type { AppRole, SessionUser } from "./types";

const isAppRole = (value: unknown): value is AppRole =>
  value === "manager" || value === "builder";

export const MISSING_ROLE_MESSAGE =
  "This account has no assigned BuildTrack role. Contact a manager";

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
    case "functions/permission-denied":
      return new Error("You do not have permission to perform this action");
    case "functions/unauthenticated":
      return new Error("Your authentication session has expired");
    case "functions/invalid-argument":
      return new Error("Invalid role request");
    default:
      return new Error("Authentication failed. Please try again");
  }
};

const getRoleFromClaims = async (user: User): Promise<AppRole | null> => {
  const token = await user.getIdTokenResult();
  return isAppRole(token.claims.role) ? token.claims.role : null;
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
    "Authenticated identity has no application role",
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
    return await toAuthorizedSessionUser(credential.user);
  } catch (error) {
    throw normalizeAuthError(error);
  }
};

export const signInWithGoogle = async (): Promise<SessionUser> => {
  try {
    const credential = await signInWithPopup(firebaseAuth, googleProvider);
    return await toAuthorizedSessionUser(credential.user);
  } catch (error) {
    throw normalizeAuthError(error);
  }
};

export const registerBuilder = async (input: {
  email: string;
  password: string;
  fullName: string;
}): Promise<SessionUser> => {
  validateRegistrationInput(input);

  try {
    const credential = await createUserWithEmailAndPassword(
      firebaseAuth,
      input.email.trim().toLowerCase(),
      input.password,
    );
    await updateProfile(credential.user, { displayName: input.fullName.trim() });
    await ensureBuilderRole();
    await credential.user.getIdToken(true);
    return await toAuthorizedSessionUser(credential.user);
  } catch (error) {
    throw normalizeAuthError(error);
  }
};

export const registerWithInvitation = async (input: {
  email: string;
  password: string;
  fullName: string;
  invitationId: string;
}): Promise<SessionUser> => {
  validateRegistrationInput(input);
  if (!input.invitationId.trim()) throw new Error("Invitation is required");

  try {
    const credential = await createUserWithEmailAndPassword(
      firebaseAuth,
      input.email.trim().toLowerCase(),
      input.password,
    );
    await updateProfile(credential.user, { displayName: input.fullName.trim() });
    await invitationOperations.consumeInvitation({ invitationId: input.invitationId.trim(), userId: credential.user.uid });
    await credential.user.getIdToken(true);
    return await toAuthorizedSessionUser(credential.user);
  } catch (error) {
    throw normalizeAuthError(error);
  }
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
