import { createRequire } from "node:module";

const requireFromFunctions = createRequire(
  new URL("../functions/package.json", import.meta.url),
);
const {
  applicationDefault,
  deleteApp,
  initializeApp,
} = requireFromFunctions("firebase-admin/app");
const { getAuth } = requireFromFunctions("firebase-admin/auth");

const PROJECT_ID = "jobsitejedi";
const ALLOWED_ROLES = new Set(["manager", "builder"]);

const args = Object.fromEntries(
  process.argv.slice(2).map((argument) => {
    const [key, ...value] = argument.replace(/^--/, "").split("=");
    return [key, value.join("=")];
  }),
);

const role = args.role;
const apply = args.apply === "true";
const targetEmail = args.email?.trim().toLowerCase() || null;
const expectedProvider = args.provider || null;
const expectedUsers = Number(args["expected-users"]);
const targetConfirmation = targetEmail
  ? `email:${targetEmail}`
  : "single-active-user";
const expectedConfirmation = `${PROJECT_ID}:${targetConfirmation}:${role}`;

if (!ALLOWED_ROLES.has(role)) {
  throw new Error("Use --role=manager or --role=builder.");
}
if (args.project !== PROJECT_ID) {
  throw new Error(`Use --project=${PROJECT_ID}.`);
}
if (targetEmail && !/^\S+@\S+\.\S+$/.test(targetEmail)) {
  throw new Error("Use a valid --email value.");
}
if (targetEmail && (!Number.isInteger(expectedUsers) || expectedUsers < 1)) {
  throw new Error("Use --expected-users=<positive integer> with --email.");
}
if (expectedProvider && !targetEmail) {
  throw new Error("Use --provider only together with --email.");
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
  const pageSize = targetEmail ? expectedUsers + 1 : 2;
  const page = await auth.listUsers(pageSize);
  const requiredUserCount = targetEmail ? expectedUsers : 1;
  if (page.users.length !== requiredUserCount || page.pageToken) {
    throw new Error(
      `Safety check failed: expected exactly ${requiredUserCount} users in the project.`,
    );
  }

  const matchingUsers = targetEmail
    ? page.users.filter((candidate) => candidate.email?.toLowerCase() === targetEmail)
    : page.users;
  if (matchingUsers.length !== 1) {
    throw new Error("Safety check failed: the target identity is not unique.");
  }

  const user = matchingUsers[0];
  if (user.disabled) {
    throw new Error("Safety check failed: the target user is disabled.");
  }
  if (
    expectedProvider &&
    !user.providerData.some((provider) => provider.providerId === expectedProvider)
  ) {
    throw new Error("Safety check failed: the target provider does not match.");
  }

  const previousClaims = JSON.parse(JSON.stringify(user.customClaims ?? {}));
  const previousRole = previousClaims.role ?? null;
  if (previousRole !== null && previousRole !== role) {
    throw new Error(
      `Safety check failed: the user already has the different role '${previousRole}'.`,
    );
  }

  if (!apply || previousRole === role) {
    console.log(
      JSON.stringify({
        project: PROJECT_ID,
        totalUsers: requiredUserCount,
        targetMode: targetEmail ? "email" : "single-active-user",
        providerVerified: expectedProvider ?? null,
        previousRole,
        requestedRole: role,
        mode: apply ? "already-applied" : "dry-run",
        changed: false,
      }),
    );
    process.exitCode = 0;
  } else {
    const nextClaims = { ...previousClaims, role };
    await auth.setCustomUserClaims(user.uid, nextClaims);

    try {
      const verified = await auth.getUser(user.uid);
      if (verified.customClaims?.role !== role) {
        throw new Error("The assigned role was not returned by Firebase Auth.");
      }
    } catch (verificationError) {
      await auth.setCustomUserClaims(user.uid, previousClaims);
      throw new Error("Role verification failed and previous claims were restored.");
    }

    console.log(
      JSON.stringify({
        project: PROJECT_ID,
        totalUsers: requiredUserCount,
        targetMode: targetEmail ? "email" : "single-active-user",
        providerVerified: expectedProvider ?? null,
        previousRole,
        currentRole: role,
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
