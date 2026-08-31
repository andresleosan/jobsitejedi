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
import {
  readRoleOperationInput,
  redactRoleOperationError,
} from "./lib/firebase-role-operation-input.mjs";
import {
  clearQaDebugEnvironment,
  createSafeQaChildEnvironment,
} from "./lib/secure-qa-process-environment.mjs";

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
const ROLE_PATHS = {
  admin: "/admins",
  manager: "/managers",
  builder: "/builders",
};
const workspaceRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const password = process.env.FIREBASE_QA_PASSWORD;
clearQaDebugEnvironment(process.env);

let roleOperationInput;
try {
  roleOperationInput = await readRoleOperationInput({
    action: "verify",
    projectId: PROJECT_ID,
  });
  if (roleOperationInput.expectedProvider !== "password") {
    throw new Error("unsupported-provider");
  }
} catch {
  console.error(JSON.stringify({
    project: PROJECT_ID,
    mode: "input-rejected",
    reason: "INVALID_INPUT",
    message: "Role verification requires one exact password-provider JSON manifest on stdin.",
  }));
  process.exit(1);
}

const {
  role: expectedRole,
  targetEmail,
  targetUid,
  expectedProvider,
  expectedUsers,
} = roleOperationInput;

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
  const childEnvironment = createSafeQaChildEnvironment(process.env);

  const server = spawn(
    process.execPath,
    [viteCli, "--host", "127.0.0.1", "--port", "41732", "--strictPort"],
    {
      cwd: workspaceRoot,
      env: childEnvironment,
      stdio: "ignore",
      windowsHide: true,
    },
  );

  let browser;
  try {
    await waitForServer(server);
    const { chromium } = await import("playwright");
    browser = await chromium.launch({
      channel: "chrome",
      headless: true,
      env: childEnvironment,
    });
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

let envSource;
try {
  envSource = await readFile(new URL("../.env", import.meta.url), "utf8");
} catch {
  console.error(JSON.stringify({
    project: PROJECT_ID,
    mode: "verification-failed",
    reason: "CLIENT_CONFIG_UNAVAILABLE",
    message: "Firebase client configuration is unavailable for login verification.",
  }));
  process.exit(1);
}
const apiKeyLine = envSource
  .split(/\r?\n/u)
  .find((line) => line.startsWith("VITE_FIREBASE_API_KEY="));
const apiKey = apiKeyLine?.slice(apiKeyLine.indexOf("=") + 1).trim();

if (!apiKey || !password) {
  console.error(JSON.stringify({
    project: PROJECT_ID,
    mode: "verification-failed",
    reason: "SECURE_INPUT_UNAVAILABLE",
    message: "Firebase client configuration and in-memory QA secret are required.",
  }));
  process.exit(1);
}

let app;
try {
  app = initializeApp({
    credential: applicationDefault(),
    projectId: PROJECT_ID,
  });
} catch {
  console.error(JSON.stringify({
    project: PROJECT_ID,
    mode: "verification-failed",
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
} catch (error) {
  const { reason, message } = redactRoleOperationError({
    error,
    action: "verification",
  });
  console.error(JSON.stringify({
    project: PROJECT_ID,
    mode: "verification-failed",
    reason,
    message,
  }));
  process.exitCode = 1;
} finally {
  await deleteApp(app);
}
