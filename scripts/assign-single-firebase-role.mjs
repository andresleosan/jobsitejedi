import { createRequire } from "node:module";
import { createHash, randomBytes } from "node:crypto";
import {
  assertRoleAssignmentTarget,
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
    action: "assign",
    projectId: PROJECT_ID,
  });
} catch {
  console.error(JSON.stringify({
    project: PROJECT_ID,
    mode: "input-rejected",
    reason: "INVALID_INPUT",
    message: "Role assignment requires one exact JSON manifest on stdin; argv is rejected.",
  }));
  process.exit(1);
}

const {
  role,
  apply,
  targetEmail,
  targetUid,
  expectedProvider,
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
      "Safety check failed: the current role differs from expectedCurrentRole.",
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
        identityBindingVerified: true,
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
      totalUsers: requiredUserCount,
      identityBindingVerified: true,
      previousRole,
      requestedRole: role,
      mode: "confirmation-required",
    }));
    await requireInteractiveRoleConfirmation({
      action: "assign",
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
    assertRoleAssignmentTarget({
      user: latestBeforeMutation,
      targetEmail,
      targetUid,
      expectedProvider,
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
      await writeAuthorizationGrantWithPrecondition({
        firestore,
        grantReference,
        expectedExists: previousGrantSnapshot.exists,
        expectedGrant: previousGrant,
        nextExists: true,
        nextGrant,
      });
      mutationAttempted = true;
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
    } catch (error) {
      if (!mutationAttempted) throw error;
      if (mutationAttempted) {
        let compensationVerified = false;
        let compensationGrantRestored = false;
        try {
          await auth.setCustomUserClaims(user.uid, previousClaims);
          await writeAuthorizationGrantWithPrecondition({
            firestore,
            grantReference,
            expectedExists: true,
            expectedGrant: nextGrant,
            nextExists: previousGrantSnapshot.exists,
            nextGrant: previousGrant,
          });
          compensationGrantRestored = true;
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
            && authorizationGrantFingerprint(restoredGrant)
              === authorizationGrantFingerprint(previousGrant)
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
          const accessFailedClosed = await writeAuthorizationGrantWithPrecondition({
            firestore,
            grantReference,
            expectedExists: compensationGrantRestored
              ? previousGrantSnapshot.exists
              : true,
            expectedGrant: compensationGrantRestored ? previousGrant : nextGrant,
            nextExists: true,
            nextGrant: inactiveGrant,
          })
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
        identityBindingVerified: true,
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
  const { reason, message } = redactRoleOperationError({
    error,
    action: "assignment",
  });

  console.error(
    JSON.stringify({
      project: PROJECT_ID,
      mode: apply ? "apply-failed" : "dry-run-failed",
      reason,
      message,
    }),
  );
  process.exitCode = 1;
} finally {
  await deleteApp(app);
}
