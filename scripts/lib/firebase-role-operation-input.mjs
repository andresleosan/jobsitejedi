import { createHash } from "node:crypto";

const MAX_INPUT_BYTES = 16 * 1024;
const ALLOWED_ROLES = new Set(["admin", "manager", "builder"]);
const BASE_IDENTITY_FIELDS = [
  "schemaVersion",
  "project",
  "email",
  "uid",
  "expectedUsers",
];
const PROVIDER_IDENTITY_FIELDS = [...BASE_IDENTITY_FIELDS, "provider"];
const ASSIGN_MUTATION_FIELDS = [
  ...PROVIDER_IDENTITY_FIELDS,
  "expectedCurrentRole",
  "apply",
];
const REVOKE_MUTATION_FIELDS = [
  ...BASE_IDENTITY_FIELDS,
  "expectedCurrentRole",
  "apply",
];

const fail = (message) => {
  throw new Error(message);
};

const requiredString = (payload, field) => {
  const value = payload[field];
  if (typeof value !== "string" || value.trim().length === 0) {
    fail(`Role operation manifest field '${field}' is invalid.`);
  }
  return value.trim();
};

const isPlainObject = (value) => (
  typeof value === "object"
  && value !== null
  && !Array.isArray(value)
  && Object.getPrototypeOf(value) === Object.prototype
);

export const buildRoleOperationBindingHash = ({
  action,
  project,
  targetEmail,
  targetUid,
  expectedProvider,
  expectedUsers,
  expectedCurrentRoleArgument,
  role,
}) => createHash("sha256")
  .update(JSON.stringify({
    schemaVersion: 1,
    action,
    project,
    targetEmail,
    targetUid,
    expectedUsers,
    expectedCurrentRole: expectedCurrentRoleArgument,
    ...(action !== "revoke" ? { expectedProvider } : {}),
    ...(action === "assign" ? { role } : {}),
  }), "utf8")
  .digest("hex");

const assertNoDuplicateObjectKeys = (rawInput) => {
  const propertyPattern = /"((?:\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4})|[^"\\])*)"\s*:/gu;
  const fields = new Set();
  for (const match of rawInput.matchAll(propertyPattern)) {
    let field;
    try {
      field = JSON.parse(`"${match[1]}"`);
    } catch {
      fail("Role operation manifest must be one valid JSON object.");
    }
    if (fields.has(field)) {
      fail("Role operation manifest contains a duplicate field.");
    }
    fields.add(field);
  }
};

export const parseRoleOperationInput = ({ rawInput, action, projectId }) => {
  if (action !== "assign" && action !== "revoke" && action !== "verify") {
    fail("Role operation action is invalid.");
  }
  if (typeof rawInput !== "string" || Buffer.byteLength(rawInput, "utf8") > MAX_INPUT_BYTES) {
    fail("Role operation manifest is missing or too large.");
  }
  assertNoDuplicateObjectKeys(rawInput);

  let payload;
  try {
    payload = JSON.parse(rawInput);
  } catch {
    fail("Role operation manifest must be one valid JSON object.");
  }
  if (!isPlainObject(payload)) {
    fail("Role operation manifest must be one valid JSON object.");
  }

  const allowedFields = new Set(
    action === "assign"
      ? [...ASSIGN_MUTATION_FIELDS, "role"]
      : action === "revoke"
        ? REVOKE_MUTATION_FIELDS
        : [...PROVIDER_IDENTITY_FIELDS, "role"],
  );
  if (Object.keys(payload).some((field) => !allowedFields.has(field))) {
    fail("Role operation manifest contains an unsupported field.");
  }
  if (payload.schemaVersion !== 1) {
    fail("Role operation manifest schemaVersion must be 1.");
  }
  if (payload.project !== projectId) {
    fail("Role operation manifest targets an unexpected project.");
  }

  const targetEmail = requiredString(payload, "email").toLowerCase();
  const targetUid = requiredString(payload, "uid");
  const expectedProvider = action === "revoke"
    ? undefined
    : requiredString(payload, "provider");
  if (!/^\S+@\S+\.\S+$/.test(targetEmail)) {
    fail("Role operation manifest email is invalid.");
  }
  if (!/^\S{1,128}$/.test(targetUid)) {
    fail("Role operation manifest UID is invalid.");
  }
  if (action !== "revoke" && !/^\S{1,128}$/.test(expectedProvider)) {
    fail("Role operation manifest provider is invalid.");
  }

  const expectedUsers = payload.expectedUsers;
  if (!Number.isInteger(expectedUsers) || expectedUsers < 1 || expectedUsers > 999) {
    fail("Role operation manifest expectedUsers must be an integer from 1 to 999.");
  }
  const expectedCurrentRoleArgument = action === "verify"
    ? undefined
    : requiredString(payload, "expectedCurrentRole");
  const expectedCurrentRole = expectedCurrentRoleArgument === "none"
    ? null
    : expectedCurrentRoleArgument;
  if (
    action !== "verify"
    && expectedCurrentRole !== null
    && !ALLOWED_ROLES.has(expectedCurrentRole)
  ) {
    fail("Role operation manifest expectedCurrentRole is invalid.");
  }
  if (action === "revoke" && expectedCurrentRole === null) {
    fail("Role revocation requires an active expectedCurrentRole.");
  }

  const role = action === "revoke" ? undefined : requiredString(payload, "role");
  if (action !== "revoke" && !ALLOWED_ROLES.has(role)) {
    fail("Role operation manifest role is invalid.");
  }
  if (action !== "verify" && typeof payload.apply !== "boolean") {
    fail("Role operation manifest apply must be a boolean.");
  }

  const operationBindingHash = action === "verify"
    ? undefined
    : buildRoleOperationBindingHash({
      action,
      project: projectId,
      targetEmail,
      targetUid,
      expectedProvider,
      expectedUsers,
      expectedCurrentRoleArgument,
      role,
    });

  return {
    role,
    apply: action === "verify" ? false : payload.apply,
    targetEmail,
    targetUid,
    expectedProvider,
    expectedUsers,
    expectedCurrentRoleArgument,
    expectedCurrentRole,
    operationBindingHash,
  };
};

export const readRoleOperationInput = async ({
  action,
  projectId,
  argv = process.argv.slice(2),
  stdin = process.stdin,
}) => {
  if (argv.length !== 0) {
    fail("Command-line arguments are rejected; provide one JSON manifest on stdin.");
  }

  const chunks = [];
  let totalBytes = 0;
  for await (const chunk of stdin) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, "utf8");
    totalBytes += buffer.length;
    if (totalBytes > MAX_INPUT_BYTES) {
      fail("Role operation manifest is missing or too large.");
    }
    chunks.push(buffer);
  }

  return parseRoleOperationInput({
    rawInput: Buffer.concat(chunks).toString("utf8"),
    action,
    projectId,
  });
};

export const redactRoleOperationError = ({ error, action }) => {
  const rawMessage = error instanceof Error ? error.message : "";
  if (rawMessage.startsWith("Interactive confirmation")) {
    return {
      reason: "CONFIRMATION_FAILED",
      message: `Role ${action} stopped because the one-time interactive confirmation was unavailable or did not match.`,
    };
  }
  if (rawMessage.includes("indeterminate")) {
    return {
      reason: "INDETERMINATE_STATE",
      message: `Role ${action} state is indeterminate; stop and inspect Auth and Firestore manually.`,
    };
  }
  if (
    rawMessage.includes("failed closed")
    || rawMessage.includes("fail-closed")
    || rawMessage.includes("manual recovery")
    || rawMessage.includes("compensation could not be verified")
  ) {
    return {
      reason: "MANUAL_RECOVERY_REQUIRED",
      message: `Role ${action} failed closed and requires manual recovery before deployment.`,
    };
  }
  if (rawMessage.includes("previous authorization state was restored")) {
    return {
      reason: "PREVIOUS_STATE_RESTORED",
      message: `Role ${action} failed; the previous authorization state was restored and verified.`,
    };
  }
  if (
    rawMessage.startsWith("Safety check failed:")
    || rawMessage.startsWith("The target ")
    || rawMessage.startsWith("The assigned authorization state")
    || rawMessage.startsWith("The revoked authorization state")
  ) {
    return {
      reason: "SAFETY_CHECK_FAILED",
      message: `Role ${action} stopped because an exact safety check did not match.`,
    };
  }
  if (typeof error === "object" && error !== null && "code" in error) {
    return {
      reason: "FIREBASE_ADMIN_FAILED",
      message: "Firebase Admin request failed; verify credentials and quota project.",
    };
  }
  return {
    reason: "OPERATION_FAILED",
    message: `Role ${action} failed without exposing the underlying error payload.`,
  };
};
