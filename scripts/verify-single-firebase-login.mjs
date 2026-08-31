import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
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
const { getFirestore } = requireFromFunctions("firebase-admin/firestore");

const PROJECT_ID = "jobsitejedi";
const ALLOWED_ROLES = new Set(["admin", "manager", "builder"]);
const ROLE_PATHS = {
  admin: "/admins",
  manager: "/managers",
  builder: "/builders",
};
const workspaceRoot = dirname(dirname(fileURLToPath(import.meta.url)));

const args = Object.fromEntries(
  process.argv.slice(2).map((argument) => {
    const [key, ...value] = argument.replace(/^--/, "").split("=");
    return [key, value.join("=")];
  }),
);
const expectedRole = args.role;
const targetEmail = args.email?.trim().toLowerCase() || null;
const targetUid = args.uid?.trim() || null;
const expectedProvider = args.provider || null;
const expectedUsers = Number(args["expected-users"]);

if (args.project !== PROJECT_ID) throw new Error(`Use --project=${PROJECT_ID}.`);
if (!ALLOWED_ROLES.has(expectedRole)) {
  throw new Error("Use --role=admin, --role=manager, or --role=builder.");
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
if (expectedProvider !== "password") {
  throw new Error("This verifier supports only the exact password provider.");
}
if (!Number.isInteger(expectedUsers) || expectedUsers < 1) {
  throw new Error("Use --expected-users=<positive integer>.");
}

const waitForServer = async (serverProcess) => {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (serverProcess.exitCode !== null) {
      throw new Error("The local Vite server stopped before UI verification.");
    }
    try {
      const response = await fetch("http://127.0.0.1:41732/auth");
      if (response.ok) return;
    } catch {
      // The server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Timed out waiting for the local Vite server.");
};

const verifyUiLogin = async (email, secret, expectedPath) => {
  const viteCli = join(workspaceRoot, "node_modules", "vite", "bin", "vite.js");
  const serverEnv = { ...process.env, VITE_FIREBASE_USE_EMULATORS: "false" };
  delete serverEnv.FIREBASE_AUTH_EMULATOR_HOST;
  delete serverEnv.FIRESTORE_EMULATOR_HOST;
  delete serverEnv.FIREBASE_STORAGE_EMULATOR_HOST;

  const server = spawn(
    process.execPath,
    [viteCli, "--host", "127.0.0.1", "--port", "41732", "--strictPort"],
    {
      cwd: workspaceRoot,
      env: serverEnv,
      stdio: "ignore",
      windowsHide: true,
    },
  );

  let browser;
  try {
    await waitForServer(server);
    const { chromium } = await import("playwright");
    browser = await chromium.launch({ channel: "chrome", headless: true });
    const page = await browser.newPage();
    await page.goto("http://127.0.0.1:41732/auth");
    await page.getByLabel("Email", { exact: true }).fill(email);
    await page.getByLabel("Password", { exact: true }).fill(secret);
    await page.getByRole("button", { name: "Sign In", exact: true }).click();
    await page.waitForURL(
      (url) => url.pathname === expectedPath,
      { timeout: 20_000 },
    );
    const missingRoleVisible = await page
      .getByText("La cuenta no tiene un rol asignado", { exact: true })
      .isVisible()
      .catch(() => false);
    if (missingRoleVisible) {
      throw new Error("The UI still reports a missing role after real login.");
    }
    return { finalPath: new URL(page.url()).pathname, missingRoleVisible };
  } finally {
    await browser?.close();
    server.kill();
  }
};

const envSource = await readFile(new URL("../.env", import.meta.url), "utf8");
const apiKeyLine = envSource
  .split(/\r?\n/u)
  .find((line) => line.startsWith("VITE_FIREBASE_API_KEY="));
const apiKey = apiKeyLine?.slice(apiKeyLine.indexOf("=") + 1).trim();
const password = process.env.FIREBASE_QA_PASSWORD;
delete process.env.FIREBASE_QA_PASSWORD;

if (!apiKey) throw new Error("VITE_FIREBASE_API_KEY is unavailable.");
if (!password) throw new Error("The QA password must be provided through secure input.");

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
  assertRoleAssignmentTarget({ user, targetEmail, targetUid, expectedProvider });

  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: targetEmail,
        password,
        returnSecureToken: true,
      }),
    },
  );

  if (!response.ok) {
    throw new Error(`Real Firebase password login failed with HTTP ${response.status}.`);
  }

  const result = await response.json();
  if (typeof result.idToken !== "string") {
    throw new Error("Firebase did not return an ID token.");
  }

  const decoded = await auth.verifyIdToken(result.idToken, true);
  if (decoded.uid !== user.uid) {
    throw new Error("The verified token does not belong to the expected user.");
  }
  if (decoded.role !== expectedRole) {
    throw new Error(`The verified token does not contain role '${expectedRole}'.`);
  }
  const authorizationGrantId = decoded.authorizationGrantId;
  if (!isAuthorizationGrantId(authorizationGrantId)) {
    throw new Error("The verified token does not contain a valid authorization grant.");
  }
  const currentUser = await auth.getUser(user.uid);
  assertRoleAssignmentTarget({
    user: currentUser,
    targetEmail,
    targetUid,
    expectedProvider,
  });
  if (
    currentUser.customClaims?.role !== expectedRole
    || currentUser.customClaims?.authorizationGrantId !== authorizationGrantId
  ) {
    throw new Error("The verified token no longer matches Firebase Auth authorization state.");
  }
  const grantSnapshot = await getFirestore(app)
    .collection("authorizationGrants")
    .doc(user.uid)
    .get();
  if (
    !grantSnapshot.exists
    || !authorizationGrantMatches({
      grant: grantSnapshot.data(),
      role: expectedRole,
      grantId: authorizationGrantId,
    })
  ) {
    throw new Error("The server-side authorization grant is not current.");
  }

  const protectedRead = await fetch(
    `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}`
      + `/databases/(default)/documents/suppliers?pageSize=1&key=${encodeURIComponent(apiKey)}`,
    { headers: { authorization: `Bearer ${result.idToken}` } },
  );
  if (!protectedRead.ok) {
    throw new Error(`Protected Firestore read failed with HTTP ${protectedRead.status}.`);
  }

  const ui = await verifyUiLogin(targetEmail, password, ROLE_PATHS[expectedRole]);

  console.log(
    JSON.stringify({
      project: PROJECT_ID,
      authenticated: true,
      tokenVerified: true,
      uidMatches: true,
      role: decoded.role,
      authorizationGrantVerified: true,
      protectedReadVerified: true,
      uiRouteVerified: ui.finalPath === ROLE_PATHS[expectedRole],
      finalPath: ui.finalPath,
      missingRoleVisible: ui.missingRoleVisible,
      credentialsPersisted: false,
    }),
  );
} finally {
  await deleteApp(app);
}
