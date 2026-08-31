import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import {
  assertRoleRevocationTarget,
  authorizationGrantMatches,
  isAuthorizationGrantId,
} from "./lib/firebase-role-safety.mjs";

const requireFromFunctions = createRequire(
  new URL("../functions/package.json", import.meta.url),
);
const {
  applicationDefault,
  deleteApp,
  initializeApp,
} = requireFromFunctions("firebase-admin/app");
const { getAuth } = requireFromFunctions("firebase-admin/auth");
const { getFirestore, Timestamp } = requireFromFunctions("firebase-admin/firestore");

const PROJECT_ID = "jobsitejedi";
const ALLOWED_ROLES = new Set(["admin", "manager", "builder"]);

const args = Object.fromEntries(
  process.argv.slice(2).map((argument) => {
    const [key, ...value] = argument.replace(/^--/, "").split("=");
    return [key, value.join("=")];
  }),
);

const expectedCurrentRole = args["expected-current-role"];
const apply = args.apply === "true";
const targetEmail = args.email?.trim().toLowerCase() || null;
const targetUid = args.uid?.trim() || null;
const expectedProvider = args.provider || null;
const expectedUsers = Number(args["expected-users"]);
const expectedConfirmation = [
  PROJECT_ID,
  "revoke",
  `email:${targetEmail}`,
  `uid:${targetUid}`,
  `provider:${expectedProvider}`,
  `current:${expectedCurrentRole}`,
].join(":");

if (!ALLOWED_ROLES.has(expectedCurrentRole)) {
  throw new Error("Use --expected-current-role=admin, manager, or builder.");
}
if (args.project !== PROJECT_ID) {
  throw new Error(`Use --project=${PROJECT_ID}.`);
}
if (!targetEmail || !/^\S+@\S+\.\S+$/.test(targetEmail)) {
  throw new Error("Use a valid exact --email value.");
}
if (!targetUid || !/^\S{1,128}$/.test(targetUid)) {
  throw new Error("Use the exact audited --uid value.");
}
if (!expectedProvider || !/^\S{1,128}$/.test(expectedProvider)) {
  throw new Error("Use the exact audited --provider value.");
}
if (!Number.isInteger(expectedUsers) || expectedUsers < 1) {
  throw new Error("Use --expected-users=<positive integer>.");
}
if (apply && args.confirm !== expectedConfirmation) {
  throw new Error(`Use --confirm=${expectedConfirmation} to apply the change.`);
}

const app = initializeApp({
  credential: applicationDefault(),
  projectId: PROJECT_ID,
});

try {
  const auth = getAuth(app);
  const page = await auth.listUsers(expectedUsers + 1);
  if (page.users.length !== expectedUsers || page.pageToken) {
    throw new Error(`Safety check failed: expected exactly ${expectedUsers} users in the project.`);
  }

  const matchingUsers = page.users.filter(
    (candidate) => candidate.email?.toLowerCase() === targetEmail,
  );
  if (matchingUsers.length !== 1) {
    throw new Error("Safety check failed: the target identity is not unique.");
  }

  const user = matchingUsers[0];
  assertRoleRevocationTarget({ user, targetEmail, targetUid, expectedProvider });
  const previousClaims = JSON.parse(JSON.stringify(user.customClaims ?? {}));
  const previousRole = previousClaims.role ?? null;
  const firestore = getFirestore(app);
  const grantReference = firestore.collection("authorizationGrants").doc(user.uid);
  const previousGrantSnapshot = await grantReference.get();
  const previousGrant = previousGrantSnapshot.exists ? previousGrantSnapshot.data() : null;
  const alreadyRevoked = previousRole === null
    && previousClaims.authorizationGrantId === undefined
    && previousClaims.invitationEnrollmentId === undefined
    && previousGrantSnapshot.exists
    && isAuthorizationGrantId(previousGrant?.grantId)
    && authorizationGrantMatches({
      grant: previousGrant,
      role: expectedCurrentRole,
      grantId: previousGrant.grantId,
      active: false,
    });

  if (previousRole !== expectedCurrentRole && !alreadyRevoked) {
    throw new Error(
      "Safety check failed: the current role differs from --expected-current-role.",
    );
  }

  if (!apply || alreadyRevoked) {
    console.log(JSON.stringify({
      project: PROJECT_ID,
      totalUsers: expectedUsers,
      targetMode: "email-and-uid",
      providerVerified: expectedProvider,
      previousRole,
      requestedAction: "revoke",
      mode: apply ? "already-revoked" : "dry-run",
      changed: false,
    }));
    process.exitCode = 0;
  } else {
    const latestBeforeMutation = await auth.getUser(user.uid);
    assertRoleRevocationTarget({
      user: latestBeforeMutation,
      targetEmail,
      targetUid,
      expectedProvider,
    });
    if (
      latestBeforeMutation.customClaims?.role !== expectedCurrentRole
      || (latestBeforeMutation.customClaims?.authorizationGrantId ?? null)
        !== (previousClaims.authorizationGrantId ?? null)
    ) {
      throw new Error("Safety check failed: the audited authorization state changed before apply.");
    }

    const revocationGrantId = isAuthorizationGrantId(previousClaims.authorizationGrantId)
      ? previousClaims.authorizationGrantId
      : randomBytes(16).toString("hex");
    const inactiveGrant = {
      active: false,
      role: expectedCurrentRole,
      grantId: revocationGrantId,
      updatedAt: Timestamp.now(),
    };
    const nextClaims = { ...previousClaims };
    delete nextClaims.role;
    delete nextClaims.authorizationGrantId;
    delete nextClaims.invitationEnrollmentId;
    let mutationAttempted = false;
    let refreshTokensRevoked = false;

    try {
      mutationAttempted = true;
      await grantReference.set(inactiveGrant);
      await auth.setCustomUserClaims(user.uid, nextClaims);
      const [verifiedUser, verifiedGrantSnapshot] = await Promise.all([
        auth.getUser(user.uid),
        grantReference.get(),
      ]);
      assertRoleRevocationTarget({
        user: verifiedUser,
        targetEmail,
        targetUid,
        expectedProvider,
      });
      if (
        verifiedUser.customClaims?.role !== undefined
        || verifiedUser.customClaims?.authorizationGrantId !== undefined
        || verifiedUser.customClaims?.invitationEnrollmentId !== undefined
        || !verifiedGrantSnapshot.exists
        || !authorizationGrantMatches({
          grant: verifiedGrantSnapshot.data(),
          role: expectedCurrentRole,
          grantId: revocationGrantId,
          active: false,
        })
      ) {
        throw new Error("The revoked authorization state was not returned exactly.");
      }
      refreshTokensRevoked = await auth.revokeRefreshTokens(user.uid)
        .then(() => true)
        .catch(() => false);
    } catch {
      if (mutationAttempted) {
        const accessFailedClosed = await grantReference.set(inactiveGrant)
          .then(() => grantReference.get())
          .then((snapshot) => snapshot.exists && authorizationGrantMatches({
            grant: snapshot.data(),
            role: expectedCurrentRole,
            grantId: revocationGrantId,
            active: false,
          }))
          .catch(() => false);
        const claimsRemoved = await auth.setCustomUserClaims(user.uid, nextClaims)
          .then(() => auth.getUser(user.uid))
          .then((currentUser) => (
            currentUser.customClaims?.role === undefined
            && currentUser.customClaims?.authorizationGrantId === undefined
            && currentUser.customClaims?.invitationEnrollmentId === undefined
          ))
          .catch(() => false);
        await auth.revokeRefreshTokens(user.uid).catch(() => undefined);
        if (!accessFailedClosed) {
          throw new Error(
            "Role revocation state is indeterminate; stop deployment and inspect Auth and Firestore manually.",
          );
        }
        if (!claimsRemoved) {
          throw new Error(
            "Role revocation failed closed, but Firebase Auth claim cleanup requires manual recovery.",
          );
        }
        throw new Error(
          "Role revocation reached the fail-closed state after a verification error; rerun the dry-run audit.",
        );
      }
      throw new Error("Role revocation failed before any mutation was attempted.");
    }

    console.log(JSON.stringify({
      project: PROJECT_ID,
      totalUsers: expectedUsers,
      targetMode: "email-and-uid",
      providerVerified: expectedProvider,
      previousRole,
      currentRole: null,
      authorizationGrantActive: false,
      refreshTokensRevoked,
      mode: "revoked-and-verified",
      changed: true,
    }));
  }
} catch (error) {
  const code = typeof error === "object" && error !== null && "code" in error
    ? String(error.code)
    : "unknown";
  const rawMessage = error instanceof Error
    ? error.message.split("\n", 1)[0]
    : "Firebase role revocation failed.";
  const message = code === "unknown"
    ? rawMessage
    : "Firebase Admin request failed; verify credentials and quota project.";

  console.error(JSON.stringify({
    project: PROJECT_ID,
    mode: apply ? "apply-failed" : "dry-run-failed",
    code,
    message,
  }));
  process.exitCode = 1;
} finally {
  await deleteApp(app);
}
