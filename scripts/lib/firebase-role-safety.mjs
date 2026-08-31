import { createHash } from "node:crypto";

const fail = (message) => {
  throw new Error(`Safety check failed: ${message}`);
};

const assertExactIdentity = ({ user, targetEmail, targetUid }) => {
  if (!user || typeof user !== "object") fail("the target identity is unavailable.");
  if (user.uid !== targetUid) fail("the target UID does not match.");
  if (user.email?.trim().toLowerCase() !== targetEmail) {
    fail("the target email does not match.");
  }
};

const assertExactProvider = ({ user, expectedProvider }) => {
  if (
    !Array.isArray(user.providerData)
    || user.providerData.length !== 1
    || user.providerData[0]?.providerId !== expectedProvider
  ) {
    fail("the target provider does not match.");
  }
};

export const isAuthorizationGrantId = (value) => (
  typeof value === "string" && /^[a-f0-9]{32}$/.test(value)
);

const canonicalize = (value) => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    if (typeof value.toMillis === "function") {
      const milliseconds = value.toMillis();
      if (Number.isFinite(milliseconds)) {
        return { $timestampMillis: milliseconds };
      }
    }
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .filter((key) => value[key] !== undefined)
        .map((key) => [key, canonicalize(value[key])]),
    );
  }
  return value;
};

const fingerprint = (value) => createHash("sha256")
  .update(JSON.stringify(canonicalize(value)), "utf8")
  .digest("hex");

export const authorizationClaimsFingerprint = (claims) => fingerprint(claims ?? {});

export const authorizationGrantFingerprint = (grant) => fingerprint(grant ?? null);

export const authorizationStateFingerprint = ({ claims, grant, grantExists }) => fingerprint({
  claims: authorizationClaimsFingerprint(claims),
  grant: authorizationGrantFingerprint(grant),
  grantExists,
});

export const writeAuthorizationGrantWithPrecondition = async ({
  firestore,
  grantReference,
  expectedExists,
  expectedGrant,
  nextExists,
  nextGrant,
}) => {
  if (
    typeof firestore?.runTransaction !== "function"
    || typeof expectedExists !== "boolean"
    || typeof nextExists !== "boolean"
    || (nextExists && (!nextGrant || typeof nextGrant !== "object"))
  ) {
    fail("the conditional grant write configuration is invalid.");
  }

  await firestore.runTransaction(async (transaction) => {
    const currentSnapshot = await transaction.get(grantReference);
    const currentGrant = currentSnapshot.exists ? currentSnapshot.data() : null;
    if (
      currentSnapshot.exists !== expectedExists
      || authorizationGrantFingerprint(currentGrant)
        !== authorizationGrantFingerprint(expectedGrant)
    ) {
      fail("the authorization grant changed before the conditional write.");
    }

    if (nextExists) transaction.set(grantReference, nextGrant);
    else transaction.delete(grantReference);
  });
};

export const authorizationGrantMatches = ({ grant, role, grantId, active = true }) => {
  if (!grant || typeof grant !== "object" || !isAuthorizationGrantId(grantId)) return false;
  if (
    Object.keys(grant).sort().join(",") !== "active,grantId,role,updatedAt"
    || grant.active !== active
    || grant.role !== role
    || grant.grantId !== grantId
    || typeof grant.updatedAt?.toMillis !== "function"
  ) {
    return false;
  }
  const updatedAt = grant.updatedAt.toMillis();
  return Number.isFinite(updatedAt) && updatedAt > 0;
};

export const assertRoleAssignmentTarget = ({
  user,
  targetEmail,
  targetUid,
  expectedProvider,
}) => {
  assertExactIdentity({ user, targetEmail, targetUid });
  assertExactProvider({ user, expectedProvider });
  if (user.disabled) fail("the target user is disabled.");
  if (user.emailVerified !== true) fail("the target email is not verified.");
  if (user.customClaims?.invitationEnrollmentId !== undefined) {
    fail("the target has an active invitation enrollment; finish or expire it first.");
  }
};

export const assertRoleRevocationTarget = ({
  user,
  targetEmail,
  targetUid,
}) => {
  assertExactIdentity({ user, targetEmail, targetUid });
};

export const assertRevokedAuthorizationState = ({
  user,
  targetEmail,
  targetUid,
  grantSnapshot,
  expectedRole,
  expectedGrantId,
}) => {
  assertRoleRevocationTarget({ user, targetEmail, targetUid });
  if (
    user.customClaims?.role !== undefined
    || user.customClaims?.authorizationGrantId !== undefined
    || user.customClaims?.invitationEnrollmentId !== undefined
    || !grantSnapshot?.exists
    || !authorizationGrantMatches({
      grant: grantSnapshot.data(),
      role: expectedRole,
      grantId: expectedGrantId,
      active: false,
    })
  ) {
    throw new Error("The revoked authorization state was not returned exactly.");
  }
};
