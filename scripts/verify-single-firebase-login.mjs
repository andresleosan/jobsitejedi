import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

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
const EXPECTED_ROLE = "manager";
const workspaceRoot = dirname(dirname(fileURLToPath(import.meta.url)));

const waitForServer = async (serverProcess) => {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (serverProcess.exitCode !== null) {
      throw new Error("The local Vite server stopped before UI verification.");
    }
    try {
      const response = await fetch("http://localhost:5173/auth");
      if (response.ok) return;
    } catch {
      // The server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Timed out waiting for the local Vite server.");
};

const verifyUiLogin = async (email, secret) => {
  const viteCli = join(workspaceRoot, "node_modules", "vite", "bin", "vite.js");
  const serverEnv = { ...process.env, VITE_FIREBASE_USE_EMULATORS: "false" };
  delete serverEnv.FIREBASE_AUTH_EMULATOR_HOST;
  delete serverEnv.FIRESTORE_EMULATOR_HOST;
  delete serverEnv.FIREBASE_STORAGE_EMULATOR_HOST;

  const server = spawn(
    process.execPath,
    [viteCli, "--host", "localhost", "--port", "5173", "--strictPort"],
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
    await page.goto("http://localhost:5173/auth");
    await page.getByLabel("Email", { exact: true }).fill(email);
    await page.getByLabel("Password", { exact: true }).fill(secret);
    await page.getByRole("button", { name: "Sign In", exact: true }).click();
    await page.waitForURL(
      (url) => url.pathname === "/managers",
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
  const page = await auth.listUsers(2);
  if (page.users.length !== 1 || page.pageToken) {
    throw new Error("Safety check failed: the project does not contain exactly one user.");
  }

  const user = page.users[0];
  if (user.disabled || !user.email) {
    throw new Error("Safety check failed: the only user cannot use password authentication.");
  }

  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: user.email,
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
  if (decoded.role !== EXPECTED_ROLE) {
    throw new Error(`The verified token does not contain role '${EXPECTED_ROLE}'.`);
  }

  const ui = await verifyUiLogin(user.email, password);

  console.log(
    JSON.stringify({
      project: PROJECT_ID,
      authenticated: true,
      tokenVerified: true,
      uidMatches: true,
      role: decoded.role,
      uiRouteVerified: ui.finalPath === "/managers",
      finalPath: ui.finalPath,
      missingRoleVisible: ui.missingRoleVisible,
      credentialsPersisted: false,
    }),
  );
} finally {
  await deleteApp(app);
}
