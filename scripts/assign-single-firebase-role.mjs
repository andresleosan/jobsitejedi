import { createRequire } from "node:module";
import { randomBytes } from "node:crypto";
import {
  assertRoleAssignmentTarget,
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

const grantFingerprint = (grant) => JSON.stringify({
  keys: grant && typeof grant === "object" ? Object.keys(grant).sort() : [],
  active: grant?.active ?? null,
  role: grant?.role ?? null,
  grantId: grant?.grantId ?? null,
  updatedAt: typeof grant?.updatedAt?.toMillis === "function"
    ? grant.updatedAt.toMillis()
    : null,
});

const args = Object.fromEntries(
  process.argv.slice(2).map((argument) => {
    const [key, ...value] = argument.replace(/^--/, "").split("=");
    return [key, value.join("=")];
  }),
);

const role = args.role;
const apply = args.apply === "true";
const targetEmail = args.email?.trim().toLowerCase() || null;
const targetUid = args.uid?.trim() || null;
const expectedProvider = args.provider || null;
const expectedUsers = Number(args["expected-users"]);
const expectedCurrentRoleArgument = args["expected-current-role"];
const expectedCurrentRole = expectedCurrentRoleArgument === "none"
  ? null
  : expectedCurrentRoleArgument;
const expectedConfirmation = [
  PROJECT_ID,
  "assign",
  `email:${targetEmail}`,
  `uid:${targetUid}`,
  `provider:${expectedProvider}`,
  `current:${expectedCurrentRoleArgument}`,
  `role:${role}`,
].join(":");

if (!ALLOWED_ROLES.has(role)) {
  throw new Error("Use --role=admin, --role=manager, or --role=builder.");
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
if (expectedCurrentRole !== null && !ALLOWED_ROLES.has(expectedCurrentRole)) {
  throw new Error("Use --expected-current-role=none, admin, manager, or builder.");
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
  const pageSize = expectedUsers + 1;
  const page = await auth.listUsers(pageSize);
  const requiredUserCount = expectedUsers;
  if (page.users.length !== requiredUserCount || page.pageToken) {
    throw new Error(
      `Safety check failed: expected exactly ${requiredUserCount} users in the project.`,
    );
  }

  const matchingUsers = page.users.filter(
    (candidate) => candidate.email?.toLowerCase() === targetEmail,
  );
  if (matchingUsers.length !== 1) {
    throw new Error("Safety check failed: the target identity is not unique.");
  }

  const user = matchingUsers[0];
  assertRoleAssignmentTarget({ user, targetEmail, targetUid, expectedProvider });

  const previousClaims = JSON.parse(JSON.stringify(user.customClaims ?? {}));
  const previousRole = previousClaims.role ?? null;
  if (previousRole !== expectedCurrentRole) {
    throw new Error(
      "Safety check failed: the current role differs from --expected-current-role.",
    );
  }

  const firestore = getFirestore(app);
  const grantReference = firestore.collection("authorizationGrants").doc(user.uid);
  const previousGrantSnapshot = await grantReference.get();
  const previousGrant = previousGrantSnapshot.exists ? previousGrantSnapshot.data() : null;
  const previousGrantId = previousClaims.authorizationGrantId;
  const authorizationGrantCurrent = previousRole === role
    && isAuthorizationGrantId(previousGrantId)
    && authorizationGrantMatches({
      grant: previousGrant,
      role,
      grantId: previousGrantId,
    });

  if (!apply || authorizationGrantCurrent) {
    console.log(
      JSON.stringify({
        project: PROJECT_ID,
        totalUsers: requiredUserCount,
        targetMode: "email-and-uid",
        providerVerified: expectedProvider,
        emailVerified: true,
        previousRole,
        requestedRole: role,
        authorizationGrantCurrent,
        mode: apply ? "already-applied" : "dry-run",
        changed: false,
      }),
    );
    process.exitCode = 0;
  } else {
    const latestBeforeMutation = await auth.getUser(user.uid);
    assertRoleAssignmentTarget({
      user: latestBeforeMutation,
      targetEmail,
      targetUid,
      expectedProvider,
    });
    if (
      (latestBeforeMutation.customClaims?.role ?? null) !== previousRole
      || (latestBeforeMutation.customClaims?.authorizationGrantId ?? null)
        !== (previousClaims.authorizationGrantId ?? null)
    ) {
      throw new Error("Safety check failed: the audited authorization state changed before apply.");
    }

    const nextGrantId = randomBytes(16).toString("hex");
    const nextClaims = {
      ...previousClaims,
      role,
      authorizationGrantId: nextGrantId,
    };
    const nextGrant = {
      active: true,
      role,
      grantId: nextGrantId,
      updatedAt: Timestamp.now(),
    };
    let mutationAttempted = false;
    let refreshTokensRevoked = false;

    try {
      mutationAttempted = true;
      await grantReference.set(nextGrant);
      await auth.setCustomUserClaims(user.uid, nextClaims);
      const [verified, verifiedGrantSnapshot] = await Promise.all([
        auth.getUser(user.uid),
        grantReference.get(),
      ]);
      assertRoleAssignmentTarget({
        user: verified,
        targetEmail,
        targetUid,
        expectedProvider,
      });
      if (
        verified.customClaims?.role !== role
        || verified.customClaims?.authorizationGrantId !== nextGrantId
        || !verifiedGrantSnapshot.exists
        || !authorizationGrantMatches({
          grant: verifiedGrantSnapshot.data(),
          role,
          grantId: nextGrantId,
        })
      ) {
        throw new Error("The assigned authorization state was not returned exactly.");
      }
      refreshTokensRevoked = await auth.revokeRefreshTokens(user.uid)
        .then(() => true)
        .catch(() => false);
    } catch {
      if (mutationAttempted) {
        let compensationVerified = false;
        try {
          await auth.setCustomUserClaims(user.uid, previousClaims);
          if (previousGrantSnapshot.exists && previousGrant) {
            await grantReference.set(previousGrant);
          } else {
            await grantReference.delete();
          }
          const [restoredUser, restoredGrantSnapshot] = await Promise.all([
            auth.getUser(user.uid),
            grantReference.get(),
          ]);
          const restoredGrant = restoredGrantSnapshot.exists
            ? restoredGrantSnapshot.data()
            : null;
          compensationVerified = (
            (restoredUser.customClaims?.role ?? null) === previousRole
            && (restoredUser.customClaims?.authorizationGrantId ?? null)
              === (previousClaims.authorizationGrantId ?? null)
            && restoredGrantSnapshot.exists === previousGrantSnapshot.exists
            && grantFingerprint(restoredGrant) === grantFingerprint(previousGrant)
          );
        } catch {
          compensationVerified = false;
        }
        await auth.revokeRefreshTokens(user.uid).catch(() => undefined);
        if (!compensationVerified) {
          const inactiveGrant = {
            active: false,
            role,
            grantId: nextGrantId,
            updatedAt: Timestamp.now(),
          };
          const accessFailedClosed = await grantReference.set(inactiveGrant)
            .then(() => grantReference.get())
            .then((snapshot) => snapshot.exists && authorizationGrantMatches({
              grant: snapshot.data(),
              role,
              grantId: nextGrantId,
              active: false,
            }))
            .catch(() => false);
          if (!accessFailedClosed) {
            throw new Error(
              "Role assignment state is indeterminate; stop deployment and inspect Auth and Firestore manually.",
            );
          }
          throw new Error(
            "Role assignment failed and compensation could not be verified; access was failed closed.",
          );
        }
      }
      throw new Error("Role assignment failed and the previous authorization state was restored.");
    }

    console.log(
      JSON.stringify({
        project: PROJECT_ID,
        totalUsers: requiredUserCount,
        targetMode: "email-and-uid",
        providerVerified: expectedProvider,
        emailVerified: true,
        previousRole,
        currentRole: role,
        authorizationGrantCurrent: true,
        refreshTokensRevoked,
        mode: "applied-and-verified",
        changed: true,
      }),
    );
  }
} catch (error) {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String(error.code)
      : "unknown";
  const rawMessage =
    error instanceof Error
      ? error.message.split("\n", 1)[0]
      : "Firebase role operation failed.";
  const message =
    code === "unknown"
      ? rawMessage
      : "Firebase Admin request failed; verify credentials and quota project.";

  console.error(
    JSON.stringify({
      project: PROJECT_ID,
      mode: apply ? "apply-failed" : "dry-run-failed",
      code,
      message,
    }),
  );
  process.exitCode = 1;
} finally {
  await deleteApp(app);
}
