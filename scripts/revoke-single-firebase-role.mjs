import { createHash, randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import {
  assertRevokedAuthorizationState,
  assertRoleRevocationTarget,
  authorizationClaimsFingerprint,
  authorizationGrantFingerprint,
  authorizationGrantMatches,
  authorizationStateFingerprint,
  isAuthorizationGrantId,
  writeAuthorizationGrantWithPrecondition,
} from "./lib/firebase-role-safety.mjs";
import {
  readRoleOperationInput,
  redactRoleOperationError,
} from "./lib/firebase-role-operation-input.mjs";
import { requireInteractiveRoleConfirmation } from "./lib/interactive-role-confirmation.mjs";

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

let roleOperationInput;
try {
  roleOperationInput = await readRoleOperationInput({
    action: "revoke",
    projectId: PROJECT_ID,
  });
} catch {
  console.error(JSON.stringify({
    project: PROJECT_ID,
    mode: "input-rejected",
    reason: "INVALID_INPUT",
    message: "Role revocation requires one exact JSON manifest on stdin; argv is rejected.",
  }));
  process.exit(1);
}

const {
  apply,
  targetEmail,
  targetUid,
  expectedUsers,
  expectedCurrentRole,
  operationBindingHash,
} = roleOperationInput;

let app;
try {
  app = initializeApp({
    credential: applicationDefault(),
    projectId: PROJECT_ID,
  });
} catch {
  console.error(JSON.stringify({
    project: PROJECT_ID,
    mode: apply ? "apply-failed" : "dry-run-failed",
    reason: "FIREBASE_INIT_FAILED",
    message: "Firebase Admin initialization failed; verify the approved runtime configuration.",
  }));
  process.exit(1);
}

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
  assertRoleRevocationTarget({ user, targetEmail, targetUid });
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
      "Safety check failed: the current role differs from expectedCurrentRole.",
    );
  }

  if (!apply || alreadyRevoked) {
    console.log(JSON.stringify({
      project: PROJECT_ID,
      totalUsers: expectedUsers,
      targetMode: "email-and-uid",
      identityBindingVerified: true,
      previousRole,
      requestedAction: "revoke",
      mode: apply ? "already-revoked" : "dry-run",
      changed: false,
    }));
    process.exitCode = 0;
  } else {
    const observedStateFingerprint = authorizationStateFingerprint({
      claims: previousClaims,
      grant: previousGrant,
      grantExists: previousGrantSnapshot.exists,
    });
    const confirmationBinding = createHash("sha256")
      .update(`${operationBindingHash}:${observedStateFingerprint}`, "utf8")
      .digest("hex");
    console.error(JSON.stringify({
      project: PROJECT_ID,
      totalUsers: expectedUsers,
      identityBindingVerified: true,
      previousRole,
      requestedAction: "revoke",
      mode: "confirmation-required",
    }));
    await requireInteractiveRoleConfirmation({
      action: "revoke",
      binding: confirmationBinding,
    });

    const [latestPage, latestGrantSnapshot] = await Promise.all([
      auth.listUsers(expectedUsers + 1),
      grantReference.get(),
    ]);
    if (latestPage.users.length !== expectedUsers || latestPage.pageToken) {
      throw new Error("Safety check failed: the user inventory changed before apply.");
    }
    const latestMatchingUsers = latestPage.users.filter(
      (candidate) => candidate.email?.toLowerCase() === targetEmail,
    );
    if (latestMatchingUsers.length !== 1) {
      throw new Error("Safety check failed: the target identity changed before apply.");
    }
    const latestBeforeMutation = latestMatchingUsers[0];
    assertRoleRevocationTarget({
      user: latestBeforeMutation,
      targetEmail,
      targetUid,
    });
    const latestGrant = latestGrantSnapshot.exists ? latestGrantSnapshot.data() : null;
    if (
      authorizationClaimsFingerprint(latestBeforeMutation.customClaims ?? {})
        !== authorizationClaimsFingerprint(previousClaims)
      || latestGrantSnapshot.exists !== previousGrantSnapshot.exists
      || authorizationGrantFingerprint(latestGrant)
        !== authorizationGrantFingerprint(previousGrant)
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
      await writeAuthorizationGrantWithPrecondition({
        firestore,
        grantReference,
        expectedExists: previousGrantSnapshot.exists,
        expectedGrant: previousGrant,
        nextExists: true,
        nextGrant: inactiveGrant,
      });
      mutationAttempted = true;
      await auth.setCustomUserClaims(user.uid, nextClaims);
      const [verifiedUser, verifiedGrantSnapshot] = await Promise.all([
        auth.getUser(user.uid),
        grantReference.get(),
      ]);
      assertRevokedAuthorizationState({
        user: verifiedUser,
        targetEmail,
        targetUid,
        grantSnapshot: verifiedGrantSnapshot,
        expectedRole: expectedCurrentRole,
        expectedGrantId: revocationGrantId,
      });
      refreshTokensRevoked = await auth.revokeRefreshTokens(user.uid)
        .then(() => true)
        .catch(() => false);
    } catch (error) {
      if (!mutationAttempted) throw error;
      if (mutationAttempted) {
        const accessFailedClosed = await grantReference.get()
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
      identityBindingVerified: true,
      previousRole,
      currentRole: null,
      authorizationGrantActive: false,
      refreshTokensRevoked,
      mode: "revoked-and-verified",
      changed: true,
    }));
  }
} catch (error) {
  const { reason, message } = redactRoleOperationError({
    error,
    action: "revocation",
  });

  console.error(JSON.stringify({
    project: PROJECT_ID,
    mode: apply ? "apply-failed" : "dry-run-failed",
    reason,
    message,
  }));
  process.exitCode = 1;
} finally {
  await deleteApp(app);
}
