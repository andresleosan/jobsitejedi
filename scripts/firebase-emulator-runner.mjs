import { existsSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const REQUIRED_NODE_MAJOR = 22;
const REQUIRED_JAVA_MAJOR = 21;
const FUNCTIONS_DISCOVERY_TIMEOUT = "30000";
const FIREBASE_SERVICES = "auth,firestore,functions,storage";
const FIREBASE_PROJECT = "demo-jobsite-jedi";

const targets = {
  unit: { script: "test:firebase", args: [] },
  "auth-unit": { script: "test:firebase:auth", args: [] },
  seed: { script: "qa:seed:emulator", args: [] },
  e2e: { script: "test:e2e:firebase", args: [] },
  "auth-e2e": {
    script: "test:e2e:firebase",
    args: ["--", "tests/auth.firebase.spec.ts", "--workers=1"],
  },
  "qa-accounts-e2e": {
    script: "test:e2e:firebase",
    args: ["--", "tests/qa-accounts.firebase.spec.ts", "--workers=1"],
  },
  "invitation-e2e": {
    script: "test:e2e:firebase",
    args: ["--", "tests/invitation-onboarding.firebase.spec.ts", "--workers=1"],
  },
  "tool-e2e": {
    script: "test:e2e:firebase",
    args: ["--", "tests/tool-inventory.firebase.spec.ts", "--workers=1"],
  },
};

const fail = (message) => {
  console.error(`[firebase-runner] ${message}`);
  process.exit(1);
};

const nodeMajor = Number.parseInt(process.versions.node.split(".")[0] ?? "", 10);
if (nodeMajor !== REQUIRED_NODE_MAJOR) {
  fail(
    `Node ${REQUIRED_NODE_MAJOR}.x is required; received ${process.version}. ` +
      "Use the version declared in .nvmrc/.node-version.",
  );
}

const targetName = process.argv[2];
const target = targets[targetName];
if (!target) {
  fail(`Unknown target '${targetName ?? ""}'. Expected one of: ${Object.keys(targets).join(", ")}.`);
}

const workspaceRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const firebaseCli = join(
  workspaceRoot,
  "node_modules",
  "firebase-tools",
  "lib",
  "bin",
  "firebase.js",
);
const npmCli = process.env.npm_execpath;

if (!existsSync(firebaseCli)) fail("firebase-tools is not installed. Run npm ci first.");
if (!npmCli || !existsSync(npmCli)) fail("npm CLI path is unavailable. Start this runner through npm.");

const javaHome = process.env.JAVA_HOME?.trim();
const javaExecutable = javaHome
  ? join(javaHome, "bin", process.platform === "win32" ? "java.exe" : "java")
  : "java";
const javaVersion = spawnSync(javaExecutable, ["-version"], {
  encoding: "utf8",
  windowsHide: true,
});
const javaOutput = `${javaVersion.stdout ?? ""}\n${javaVersion.stderr ?? ""}`;
const javaMatch = javaOutput.match(/version\s+"(?:1\.)?(\d+)/i);
const javaMajor = Number.parseInt(javaMatch?.[1] ?? "", 10);

if (javaVersion.error || javaVersion.status !== 0 || javaMajor !== REQUIRED_JAVA_MAJOR) {
  fail(
    `JDK ${REQUIRED_JAVA_MAJOR} is required. Set JAVA_HOME to a JDK ${REQUIRED_JAVA_MAJOR} installation.`,
  );
}

const javaBin = javaHome ? join(javaHome, "bin") : null;
const childEnv = {
  ...process.env,
  FUNCTIONS_DISCOVERY_TIMEOUT,
  ENFORCE_APP_CHECK: "false",
  ...(javaBin
    ? { PATH: `${javaBin}${delimiter}${process.env.PATH ?? ""}` }
    : {}),
};

// Some host environments define DEBUG for unrelated tooling. Firebase Tools
// interprets any inherited value as a request for verbose diagnostics, which
// includes printing the full child environment. Do not let test logs disclose
// credentials that happen to be present in the parent process.
delete childEnv.DEBUG;

const runNode = (args) =>
  spawnSync(process.execPath, args, {
    cwd: workspaceRoot,
    env: childEnv,
    stdio: "inherit",
    windowsHide: true,
  });

console.log(
  `[firebase-runner] Node ${process.versions.node}; Java ${javaMajor}; ` +
    `Functions discovery timeout ${FUNCTIONS_DISCOVERY_TIMEOUT}ms.`,
);

const build = runNode([npmCli, "run", "build:functions"]);
if (build.error || build.status !== 0) process.exit(build.status ?? 1);

const quote = (value) => `"${value.replaceAll('"', '\\"')}"`;
const testCommand = [
  quote(process.execPath),
  quote(npmCli),
  "run",
  target.script,
  ...target.args.map(quote),
].join(" ");
const result = runNode([
  firebaseCli,
  "emulators:exec",
  "--only",
  FIREBASE_SERVICES,
  "--project",
  FIREBASE_PROJECT,
  testCommand,
]);

process.exit(result.status ?? 1);
