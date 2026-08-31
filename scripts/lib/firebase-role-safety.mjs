const fail = (message) => {
  throw new Error(`Safety check failed: ${message}`);
};

const assertExactIdentity = ({ user, targetEmail, targetUid, expectedProvider }) => {
  if (!user || typeof user !== "object") fail("the target identity is unavailable.");
  if (user.uid !== targetUid) fail("the target UID does not match.");
  if (user.email?.trim().toLowerCase() !== targetEmail) {
    fail("the target email does not match.");
  }
  if (
    !Array.isArray(user.providerData)
    || !user.providerData.some((provider) => provider?.providerId === expectedProvider)
  ) {
    fail("the target provider does not match.");
  }
};

export const isAuthorizationGrantId = (value) => (
  typeof value === "string" && /^[a-f0-9]{32}$/.test(value)
);

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
  assertExactIdentity({ user, targetEmail, targetUid, expectedProvider });
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
  expectedProvider,
}) => {
  assertExactIdentity({ user, targetEmail, targetUid, expectedProvider });
};
