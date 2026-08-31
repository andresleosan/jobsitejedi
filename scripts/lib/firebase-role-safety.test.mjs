import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  assertRevokedAuthorizationState,
  assertRoleAssignmentTarget,
  assertRoleRevocationTarget,
  authorizationClaimsFingerprint,
  authorizationGrantFingerprint,
  authorizationGrantMatches,
  authorizationStateFingerprint,
  writeAuthorizationGrantWithPrecondition,
} from "./firebase-role-safety.mjs";
import {
  buildRoleOperationBindingHash,
  parseRoleOperationInput,
  readRoleOperationInput,
  redactRoleOperationError,
} from "./firebase-role-operation-input.mjs";
import { requireInteractiveRoleConfirmation } from "./interactive-role-confirmation.mjs";
import {
  clearQaDebugEnvironment,
  createSafeQaChildEnvironment,
} from "./secure-qa-process-environment.mjs";

const assignRoleScript = fileURLToPath(
  new URL("../assign-single-firebase-role.mjs", import.meta.url),
);
const operationalRoleScripts = [
  assignRoleScript,
  fileURLToPath(new URL("../revoke-single-firebase-role.mjs", import.meta.url)),
  fileURLToPath(new URL("../verify-single-firebase-login.mjs", import.meta.url)),
];

const eligibleUser = () => ({
  uid: "verified-target-uid",
  email: "verified@example.test",
  emailVerified: true,
  disabled: false,
  providerData: [{ providerId: "password" }],
  customClaims: {},
});

const validate = (user) => assertRoleAssignmentTarget({
  user,
  targetEmail: "verified@example.test",
  targetUid: "verified-target-uid",
  expectedProvider: "password",
});

const operationManifest = (overrides = {}) => ({
  schemaVersion: 1,
  project: "jobsitejedi",
  email: "Verified@Example.test",
  uid: "verified-target-uid",
  provider: "password",
  expectedUsers: 5,
  expectedCurrentRole: "none",
  role: "manager",
  apply: false,
  ...overrides,
});

test("accepts only the exact verified identity and provider", () => {
  assert.doesNotThrow(() => validate(eligibleUser()));
});

test("rejects an unverified email before administrative role assignment", () => {
  assert.throws(
    () => validate({ ...eligibleUser(), emailVerified: false }),
    /target email is not verified/,
  );
});

test("rejects identity, provider, disabled-state, and enrollment mismatches", () => {
  const cases = [
    [{ ...eligibleUser(), uid: "other-uid" }, /target UID does not match/],
    [{ ...eligibleUser(), email: "other@example.test" }, /target email does not match/],
    [{ ...eligibleUser(), providerData: [{ providerId: "google.com" }] }, /provider does not match/],
    [
      {
        ...eligibleUser(),
        providerData: [{ providerId: "password" }, { providerId: "google.com" }],
      },
      /provider does not match/,
    ],
    [{ ...eligibleUser(), disabled: true }, /target user is disabled/],
    [
      { ...eligibleUser(), customClaims: { invitationEnrollmentId: "active" } },
      /active invitation enrollment/,
    ],
  ];

  for (const [user, expectedError] of cases) {
    assert.throws(() => validate(user), expectedError);
  }
});

test("allows an exact identity to be revoked despite mutable provider or account state", () => {
  assert.doesNotThrow(() => assertRoleRevocationTarget({
    user: {
      ...eligibleUser(),
      disabled: true,
      emailVerified: false,
      providerData: [{ providerId: "password" }, { providerId: "google.com" }],
    },
    targetEmail: "verified@example.test",
    targetUid: "verified-target-uid",
  }));
  assert.throws(() => assertRoleRevocationTarget({
    user: { ...eligibleUser(), uid: "other-uid" },
    targetEmail: "verified@example.test",
    targetUid: "verified-target-uid",
  }), /target UID does not match/);
});

test("verifies the complete post-mutation revocation state without consulting providers", () => {
  const grantId = "c".repeat(32);
  const revokedUser = {
    ...eligibleUser(),
    disabled: true,
    providerData: [{ providerId: "password" }, { providerId: "google.com" }],
    customClaims: { unrelated: true },
  };
  const grantSnapshot = {
    exists: true,
    data: () => ({
      active: false,
      role: "manager",
      grantId,
      updatedAt: { toMillis: () => 1_700_000_000_000 },
    }),
  };

  assert.doesNotThrow(() => assertRevokedAuthorizationState({
    user: revokedUser,
    targetEmail: "verified@example.test",
    targetUid: "verified-target-uid",
    grantSnapshot,
    expectedRole: "manager",
    expectedGrantId: grantId,
  }));
  assert.throws(() => assertRevokedAuthorizationState({
    user: { ...revokedUser, customClaims: { role: "manager" } },
    targetEmail: "verified@example.test",
    targetUid: "verified-target-uid",
    grantSnapshot,
    expectedRole: "manager",
    expectedGrantId: grantId,
  }), /revoked authorization state/);
});

test("matches only an exact, timestamped authorization grant", () => {
  const grantId = "a".repeat(32);
  const grant = {
    active: true,
    role: "manager",
    grantId,
    updatedAt: { toMillis: () => 1_700_000_000_000 },
  };
  assert.equal(authorizationGrantMatches({ grant, role: "manager", grantId }), true);
  assert.equal(authorizationGrantMatches({ grant: { ...grant, active: false }, role: "manager", grantId }), false);
  assert.equal(authorizationGrantMatches({ grant: { ...grant, extra: true }, role: "manager", grantId }), false);
  assert.equal(authorizationGrantMatches({ grant, role: "admin", grantId }), false);
  assert.equal(authorizationGrantMatches({ grant, role: "manager", grantId: "short" }), false);
});

test("parses a redacted assign manifest and returns only an internal operation binding", () => {
  const parsed = parseRoleOperationInput({
    rawInput: JSON.stringify(operationManifest()),
    action: "assign",
    projectId: "jobsitejedi",
  });

  assert.equal(parsed.targetEmail, "verified@example.test");
  assert.equal(parsed.expectedCurrentRole, null);
  assert.match(parsed.operationBindingHash, /^[a-f0-9]{64}$/);
  assert.equal(parsed.operationBindingHash.includes("verified"), false);
});

test("changes the internal operation binding for every bound field", () => {
  const base = {
    action: "assign",
    project: "jobsitejedi",
    targetEmail: "verified@example.test",
    targetUid: "verified-target-uid",
    expectedProvider: "password",
    expectedUsers: 5,
    expectedCurrentRoleArgument: "none",
    role: "manager",
  };
  const baseline = buildRoleOperationBindingHash(base);
  const mutations = [
    { action: "revoke" },
    { project: "another-project" },
    { targetEmail: "another@example.test" },
    { targetUid: "another-target-uid" },
    { expectedProvider: "google.com" },
    { expectedUsers: 6 },
    { expectedCurrentRoleArgument: "builder" },
    { role: "admin" },
  ];

  assert.match(baseline, /^[a-f0-9]{64}$/);
  for (const mutation of mutations) {
    assert.notEqual(buildRoleOperationBindingHash({ ...base, ...mutation }), baseline);
  }
});

test("rejects command-line arguments before reading privileged identity input", async () => {
  await assert.rejects(
    readRoleOperationInput({
      action: "assign",
      projectId: "jobsitejedi",
      argv: ["--email=must-not-be-on-argv@example.test"],
      stdin: [],
    }),
    /Command-line arguments are rejected/,
  );
});

test("rejects unsupported and duplicate manifest fields", () => {
  assert.throws(() => parseRoleOperationInput({
    rawInput: JSON.stringify(operationManifest({ unexpected: true })),
    action: "assign",
    projectId: "jobsitejedi",
  }), /unsupported field/);

  const duplicateEmail = JSON.stringify(operationManifest()).replace(
    '"email":"Verified@Example.test"',
    '"email":"first@example.test","email":"second@example.test"',
  );
  assert.throws(() => parseRoleOperationInput({
    rawInput: duplicateEmail,
    action: "assign",
    projectId: "jobsitejedi",
  }), /duplicate field/);

  const escapedDuplicateEmail = JSON.stringify(operationManifest()).replace(
    '"email":"Verified@Example.test"',
    '"email":"first@example.test","\\u0065mail":"second@example.test"',
  );
  assert.throws(() => parseRoleOperationInput({
    rawInput: escapedDuplicateEmail,
    action: "assign",
    projectId: "jobsitejedi",
  }), /duplicate field/);
});

test("requires an active exact role for revocation manifests", () => {
  const revokeManifest = operationManifest({
    expectedCurrentRole: "manager",
  });
  delete revokeManifest.role;
  delete revokeManifest.provider;
  const parsed = parseRoleOperationInput({
    rawInput: JSON.stringify(revokeManifest),
    action: "revoke",
    projectId: "jobsitejedi",
  });
  assert.equal(parsed.expectedCurrentRole, "manager");
  assert.equal(parsed.expectedProvider, undefined);
  assert.throws(() => parseRoleOperationInput({
    rawInput: JSON.stringify({ ...revokeManifest, expectedCurrentRole: "none" }),
    action: "revoke",
    projectId: "jobsitejedi",
  }), /requires an active expectedCurrentRole/);
  assert.throws(() => parseRoleOperationInput({
    rawInput: JSON.stringify({ ...revokeManifest, provider: "password" }),
    action: "revoke",
    projectId: "jobsitejedi",
  }), /unsupported field/);
});

test("parses a verification manifest without mutation controls", () => {
  const verifyManifest = operationManifest();
  delete verifyManifest.expectedCurrentRole;
  delete verifyManifest.apply;
  const parsed = parseRoleOperationInput({
    rawInput: JSON.stringify(verifyManifest),
    action: "verify",
    projectId: "jobsitejedi",
  });

  assert.equal(parsed.role, "manager");
  assert.equal(parsed.apply, false);
  assert.equal(parsed.operationBindingHash, undefined);
  assert.throws(() => parseRoleOperationInput({
    rawInput: JSON.stringify({ ...verifyManifest, apply: false }),
    action: "verify",
    projectId: "jobsitejedi",
  }), /unsupported field/);
});

test("requires a fresh matching interactive challenge and refuses the default prompt in CI", async () => {
  const binding = "b".repeat(64);
  const issuedChallenges = [];
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await assert.doesNotReject(() => requireInteractiveRoleConfirmation({
      action: "assign",
      binding,
      environment: {},
      prompt: async ({ challenge }) => {
        issuedChallenges.push(challenge);
        return challenge;
      },
    }));
  }
  assert.notEqual(issuedChallenges[0], issuedChallenges[1]);
  await assert.rejects(() => requireInteractiveRoleConfirmation({
    action: "assign",
    binding,
    environment: {},
    prompt: async () => "0".repeat(24),
  }), /did not match/);
  await assert.rejects(() => requireInteractiveRoleConfirmation({
    action: "assign",
    binding,
    environment: { CI: "1" },
  }), /unavailable in CI/);
});

test("fingerprints the complete authorization state canonically", () => {
  const claimsA = { role: "manager", nested: { second: 2, first: 1 } };
  const claimsB = { nested: { first: 1, second: 2 }, role: "manager" };
  assert.equal(
    authorizationClaimsFingerprint(claimsA),
    authorizationClaimsFingerprint(claimsB),
  );
  assert.notEqual(
    authorizationClaimsFingerprint(claimsA),
    authorizationClaimsFingerprint({ ...claimsA, unrelated: true }),
  );

  const grantA = {
    active: true,
    role: "manager",
    grantId: "a".repeat(32),
    updatedAt: { toMillis: () => 1_700_000_000_000 },
    metadata: { second: 2, first: 1 },
  };
  const grantB = {
    metadata: { first: 1, second: 2 },
    updatedAt: { toMillis: () => 1_700_000_000_000 },
    grantId: "a".repeat(32),
    role: "manager",
    active: true,
  };
  assert.equal(
    authorizationGrantFingerprint(grantA),
    authorizationGrantFingerprint(grantB),
  );
  assert.notEqual(
    authorizationGrantFingerprint(grantA),
    authorizationGrantFingerprint({ ...grantA, metadata: { first: 1, second: 3 } }),
  );
  assert.notEqual(
    authorizationGrantFingerprint(grantA),
    authorizationGrantFingerprint({
      ...grantA,
      updatedAt: { toMillis: () => 1_700_000_000_001 },
    }),
  );
  assert.notEqual(
    authorizationStateFingerprint({ claims: claimsA, grant: grantA, grantExists: true }),
    authorizationStateFingerprint({ claims: claimsA, grant: grantA, grantExists: false }),
  );
});

test("writes and removes an unchanged grant through a transactional precondition", async () => {
  const grantReference = { path: "authorizationGrants/verified-target-uid" };
  const originalGrant = {
    active: true,
    role: "manager",
    grantId: "a".repeat(32),
    updatedAt: { toMillis: () => 1_700_000_000_000 },
  };
  const replacementGrant = {
    active: false,
    role: "manager",
    grantId: "b".repeat(32),
    updatedAt: { toMillis: () => 1_700_000_000_001 },
  };
  let storedGrant = originalGrant;
  const firestore = {
    runTransaction: async (operation) => operation({
      get: async () => ({ exists: storedGrant !== null, data: () => storedGrant }),
      set: (_reference, value) => { storedGrant = value; },
      delete: () => { storedGrant = null; },
    }),
  };

  await writeAuthorizationGrantWithPrecondition({
    firestore,
    grantReference,
    expectedExists: true,
    expectedGrant: originalGrant,
    nextExists: true,
    nextGrant: replacementGrant,
  });
  assert.equal(storedGrant, replacementGrant);

  await writeAuthorizationGrantWithPrecondition({
    firestore,
    grantReference,
    expectedExists: true,
    expectedGrant: replacementGrant,
    nextExists: false,
    nextGrant: null,
  });
  assert.equal(storedGrant, null);
});

test("refuses to overwrite a concurrently changed grant or tombstone", async () => {
  const grantReference = { path: "authorizationGrants/verified-target-uid" };
  const auditedGrant = {
    active: true,
    role: "manager",
    grantId: "a".repeat(32),
    updatedAt: { toMillis: () => 1_700_000_000_000 },
  };
  const concurrentTombstone = {
    active: false,
    role: "manager",
    grantId: "a".repeat(32),
    updatedAt: { toMillis: () => 1_700_000_000_001 },
  };
  let writes = 0;
  const firestore = {
    runTransaction: async (operation) => operation({
      get: async () => ({ exists: true, data: () => concurrentTombstone }),
      set: () => { writes += 1; },
      delete: () => { writes += 1; },
    }),
  };

  await assert.rejects(() => writeAuthorizationGrantWithPrecondition({
    firestore,
    grantReference,
    expectedExists: true,
    expectedGrant: auditedGrant,
    nextExists: true,
    nextGrant: { ...auditedGrant, grantId: "b".repeat(32) },
  }), /authorization grant changed/);
  assert.equal(writes, 0);
});

test("removes QA debug controls and isolates child processes from hostile secrets", () => {
  const canary = "qa-secret-debug-canary";
  const mutableEnvironment = {
    DEBUG: `pw:protocol:${canary}`,
    PWDEBUG: canary,
    NODE_DEBUG: canary,
    NODE_OPTIONS: `--require=${canary}`,
    FIREBASE_QA_PASSWORD: canary,
    PLAYWRIGHT_TEST_BASE_URL: canary,
    KEEP_FOR_ADMIN: canary,
  };
  clearQaDebugEnvironment(mutableEnvironment);
  assert.deepEqual(mutableEnvironment, { KEEP_FOR_ADMIN: canary });

  const hostileEnvironment = {
    ...process.env,
    DEBUG: `pw:protocol:${canary}`,
    PWDEBUG: canary,
    FIREBASE_QA_PASSWORD: canary,
    GOOGLE_APPLICATION_CREDENTIALS: canary,
    VITE_FIREBASE_API_KEY: canary,
    CUSTOM_SECRET: canary,
  };
  const childEnvironment = createSafeQaChildEnvironment(hostileEnvironment);
  assert.equal(childEnvironment.VITE_FIREBASE_USE_EMULATORS, "false");
  assert.equal(childEnvironment.PATH ?? childEnvironment.Path, hostileEnvironment.PATH ?? hostileEnvironment.Path);
  for (const forbiddenKey of [
    "DEBUG",
    "PWDEBUG",
    "FIREBASE_QA_PASSWORD",
    "GOOGLE_APPLICATION_CREDENTIALS",
    "VITE_FIREBASE_API_KEY",
    "CUSTOM_SECRET",
  ]) {
    assert.equal(childEnvironment[forbiddenKey], undefined);
  }

  const result = spawnSync(
    process.execPath,
    ["-e", "process.stdout.write(JSON.stringify(process.env))"],
    { encoding: "utf8", env: childEnvironment },
  );
  assert.equal(result.status, 0);
  assert.equal(`${result.stdout}${result.stderr}`.includes(canary), false);
});

test("redacts arbitrary error payloads while preserving recovery severity", () => {
  const canary = "private-email-and-uid-canary";
  const generic = redactRoleOperationError({
    error: new Error(`Unexpected SDK payload: ${canary}`),
    action: "assignment",
  });
  const indeterminate = redactRoleOperationError({
    error: new Error(`Role state is indeterminate: ${canary}`),
    action: "assignment",
  });

  assert.equal(JSON.stringify(generic).includes(canary), false);
  assert.equal(generic.reason, "OPERATION_FAILED");
  assert.equal(JSON.stringify(indeterminate).includes(canary), false);
  assert.equal(indeterminate.reason, "INDETERMINATE_STATE");

  const confirmation = redactRoleOperationError({
    error: new Error(`Interactive confirmation failed: ${canary}`),
    action: "assignment",
  });
  const concurrentGrant = redactRoleOperationError({
    error: new Error("Safety check failed: the authorization grant changed before the conditional write."),
    action: "assignment",
  });
  assert.equal(JSON.stringify(confirmation).includes(canary), false);
  assert.equal(confirmation.reason, "CONFIRMATION_FAILED");
  assert.equal(concurrentGrant.reason, "SAFETY_CHECK_FAILED");
});

test("the operational script rejects argv without echoing a PII canary", () => {
  const canary = "argv-canary@example.test";
  const result = spawnSync(process.execPath, [assignRoleScript, `--email=${canary}`], {
    encoding: "utf8",
  });
  const output = `${result.stdout}${result.stderr}`;

  assert.equal(result.status, 1);
  assert.match(output, /"reason":"INVALID_INPUT"/);
  assert.equal(output.includes(canary), false);
});

test("the operational script rejects invalid stdin without echoing a PII canary", () => {
  const canary = "stdin-canary@example.test";
  const result = spawnSync(process.execPath, [assignRoleScript], {
    encoding: "utf8",
    input: JSON.stringify(operationManifest({ unexpected: canary })),
  });
  const output = `${result.stdout}${result.stderr}`;

  assert.equal(result.status, 1);
  assert.match(output, /"reason":"INVALID_INPUT"/);
  assert.equal(output.includes(canary), false);
});

test("all privileged role scripts keep identity fields out of argv and raw logs", () => {
  for (const scriptPath of operationalRoleScripts) {
    const source = readFileSync(scriptPath, "utf8");
    assert.equal(source.includes("process.argv.slice"), false);
    assert.equal(source.includes("providerVerified: expectedProvider"), false);
    assert.equal(source.includes("rawMessage"), false);
    assert.match(source, /readRoleOperationInput/);
  }
});

test("the login verifier clears debug state before Playwright and uses only the safe child environment", () => {
  const verifySource = readFileSync(operationalRoleScripts[2], "utf8");
  const clearIndex = verifySource.indexOf("clearQaDebugEnvironment(process.env)");
  const playwrightImportIndex = verifySource.indexOf('await import("playwright")');

  assert.ok(clearIndex >= 0);
  assert.ok(playwrightImportIndex > clearIndex);
  assert.equal(verifySource.includes("...process.env"), false);
  assert.match(verifySource, /createSafeQaChildEnvironment\(process\.env\)/);
  assert.match(
    verifySource,
    /chromium\.launch\(\{[\s\S]*?env: childEnvironment,/,
  );
});

test("mutation scripts require an interactive state-bound confirmation", () => {
  for (const scriptPath of operationalRoleScripts.slice(0, 2)) {
    const source = readFileSync(scriptPath, "utf8");
    assert.match(source, /authorizationStateFingerprint/);
    assert.match(source, /requireInteractiveRoleConfirmation/);
    assert.match(source, /writeAuthorizationGrantWithPrecondition/);
    assert.match(source, /the audited authorization state changed before apply/);
    assert.match(source, /catch \(error\) \{\s+if \(!mutationAttempted\) throw error;/);
    assert.equal(source.includes("confirmationHash"), false);
  }
});
