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
const expectedConfirmation = `${PROJECT_ID}:single-active-user:${role}`;

if (!ALLOWED_ROLES.has(role)) {
  throw new Error("Use --role=manager or --role=builder.");
}
if (args.project !== PROJECT_ID) {
  throw new Error(`Use --project=${PROJECT_ID}.`);
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
  const page = await auth.listUsers(2);
  if (page.users.length !== 1 || page.pageToken) {
    throw new Error("Safety check failed: the project does not contain exactly one user.");
  }

  const user = page.users[0];
  if (user.disabled) {
    throw new Error("Safety check failed: the only user is disabled.");
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
        totalUsers: 1,
        activeUsers: 1,
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
      throw new Error(
        `Role verification failed and previous claims were restored: ${verificationError instanceof Error ? verificationError.message : "unknown error"}`,
      );
    }

    console.log(
      JSON.stringify({
        project: PROJECT_ID,
        totalUsers: 1,
        activeUsers: 1,
        previousRole,
        currentRole: role,
        mode: "applied-and-verified",
        changed: true,
      }),
    );
  }
} finally {
  await deleteApp(app);
}
