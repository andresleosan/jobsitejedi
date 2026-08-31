import { getApps, initializeApp } from "../../functions/node_modules/firebase-admin/lib/app/index.js";
import { getAuth } from "../../functions/node_modules/firebase-admin/lib/auth/index.js";
import { getFirestore, Timestamp } from "../../functions/node_modules/firebase-admin/lib/firestore/index.js";

export const FIREBASE_EMULATOR_PROJECT_ID = "demo-jobsite-jedi";

const EMULATOR_APP_NAME = "jobsite-jedi-auth-emulator-fixtures";
const APP_ROLES = new Set(["admin", "manager", "builder"]);

const fail = (message) => {
  throw new Error(`[auth-emulator-fixtures] ${message}`);
};

const requireText = (value, label) => {
  if (typeof value !== "string" || !value.trim()) {
    fail(`${label} is required`);
  }

  return value.trim();
};

const isLoopbackHost = (value) => {
  const host = value.toLowerCase();
  return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
};

export const assertAuthEmulatorOnly = () => {
  const emulatorHost = process.env.FIREBASE_AUTH_EMULATOR_HOST?.trim();
  if (!emulatorHost || emulatorHost.includes("://")) {
    fail("FIREBASE_AUTH_EMULATOR_HOST must target a local Firebase Auth emulator");
  }

  const separatorIndex = emulatorHost.lastIndexOf(":");
  const host = separatorIndex > -1 ? emulatorHost.slice(0, separatorIndex) : emulatorHost;
  const port = separatorIndex > -1 ? emulatorHost.slice(separatorIndex + 1) : "";
  if (!isLoopbackHost(host) || !/^\d{1,5}$/.test(port)) {
    fail("Refusing to provision users outside a loopback Firebase Auth emulator");
  }

  const configuredProjectId = (
    process.env.GCLOUD_PROJECT
    || process.env.GOOGLE_CLOUD_PROJECT
    || FIREBASE_EMULATOR_PROJECT_ID
  ).trim();
  if (configuredProjectId !== FIREBASE_EMULATOR_PROJECT_ID) {
    fail(`Expected emulator project ${FIREBASE_EMULATOR_PROJECT_ID}`);
  }

  return { emulatorHost, projectId: configuredProjectId };
};

export const assertFirestoreEmulatorOnly = () => {
  const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST?.trim();
  if (!emulatorHost || emulatorHost.includes("://")) {
    fail("FIRESTORE_EMULATOR_HOST must target a local Firestore emulator");
  }

  const separatorIndex = emulatorHost.lastIndexOf(":");
  const host = separatorIndex > -1 ? emulatorHost.slice(0, separatorIndex) : emulatorHost;
  const port = separatorIndex > -1 ? emulatorHost.slice(separatorIndex + 1) : "";
  if (!isLoopbackHost(host) || !/^\d{1,5}$/.test(port)) {
    fail("Refusing to seed projects outside a loopback Firestore emulator");
  }

  const configuredProjectId = (
    process.env.GCLOUD_PROJECT
    || process.env.GOOGLE_CLOUD_PROJECT
    || FIREBASE_EMULATOR_PROJECT_ID
  ).trim();
  if (configuredProjectId !== FIREBASE_EMULATOR_PROJECT_ID) {
    fail(`Expected emulator project ${FIREBASE_EMULATOR_PROJECT_ID}`);
  }

  return { emulatorHost, projectId: configuredProjectId };
};

const getEmulatorAuth = () => {
  const { projectId } = assertAuthEmulatorOnly();
  const existingApp = getApps().find((candidate) => candidate.name === EMULATOR_APP_NAME);
  if (existingApp && existingApp.options.projectId !== projectId) {
    fail("Existing Firebase Admin fixture app uses an unexpected project");
  }
  const app = existingApp ?? initializeApp({ projectId }, EMULATOR_APP_NAME);
  return getAuth(app);
};

const isUserNotFound = (error) => (
  typeof error === "object"
  && error !== null
  && "code" in error
  && error.code === "auth/user-not-found"
);

/**
 * Creates or refreshes an Auth Emulator identity and assigns only a supported
 * application role. Passing null intentionally removes the application role so
 * negative authorization paths can be tested.
 */
export const provisionEmulatorUser = async ({
  email,
  password,
  displayName,
  fullName,
  role,
  disabled = false,
}) => {
  const normalizedEmail = requireText(email, "Email").toLowerCase();
  const normalizedDisplayName = requireText(displayName ?? fullName, "Display name");
  if (!/^\S+@\S+\.\S+$/.test(normalizedEmail)) fail("Email is invalid");
  if (typeof password !== "string" || password.length < 6) {
    fail("Password must contain at least 6 characters");
  }
  if (role !== null && !APP_ROLES.has(role)) {
    fail("Role must be admin, manager, builder, or null");
  }
  if (typeof disabled !== "boolean") fail("Disabled must be a boolean");

  const auth = getEmulatorAuth();
  let user;
  try {
    user = await auth.getUserByEmail(normalizedEmail);
    user = await auth.updateUser(user.uid, {
      email: normalizedEmail,
      password,
      displayName: normalizedDisplayName,
      disabled,
    });
  } catch (error) {
    if (!isUserNotFound(error)) throw error;
    user = await auth.createUser({
      email: normalizedEmail,
      password,
      displayName: normalizedDisplayName,
      disabled,
    });
  }

  const claims = role === null ? {} : { role };
  await auth.setCustomUserClaims(user.uid, claims);

  const verified = await auth.getUser(user.uid);
  const verifiedRole = verified.customClaims?.role ?? null;
  if (verifiedRole !== role) fail("Role verification failed");

  return {
    uid: verified.uid,
    email: verified.email ?? normalizedEmail,
    displayName: verified.displayName ?? normalizedDisplayName,
    role,
    disabled: verified.disabled,
  };
};

export const seedEmulatorProject = async ({
  projectId,
  builderId,
  createdBy,
  name,
  description = null,
  clientName,
  address = null,
  status = "active",
}) => {
  const { projectId: emulatorProjectId } = assertFirestoreEmulatorOnly();
  const normalizedProjectId = requireText(projectId, "Project id");
  const normalizedBuilderId = requireText(builderId, "Builder id");
  const normalizedCreatedBy = requireText(createdBy, "Project creator id");
  const normalizedName = requireText(name, "Project name");
  const normalizedClientName = requireText(clientName, "Client name");
  if (
    !/^[A-Za-z0-9_-]{1,128}$/.test(normalizedProjectId)
    || !/^[A-Za-z0-9_-]{1,128}$/.test(normalizedBuilderId)
    || !/^[A-Za-z0-9_-]{1,128}$/.test(normalizedCreatedBy)
  ) {
    fail("Project and user ids must use the Firebase-safe id contract");
  }
  if (!new Set(["active", "finished", "on_hold"]).has(status)) {
    fail("Project status is invalid");
  }
  if (description !== null && typeof description !== "string") fail("Project description is invalid");
  if (address !== null && typeof address !== "string") fail("Project address is invalid");

  const app = getApps().find((candidate) => candidate.name === EMULATOR_APP_NAME)
    ?? initializeApp({ projectId: emulatorProjectId }, EMULATOR_APP_NAME);
  const now = Timestamp.now();
  await getFirestore(app).collection("projects").doc(normalizedProjectId).create({
    builderId: normalizedBuilderId,
    ownerId: normalizedBuilderId,
    createdBy: normalizedCreatedBy,
    name: normalizedName,
    description: description?.trim() || null,
    clientName: normalizedClientName,
    address: address?.trim() || null,
    status,
    createdAt: now,
    updatedAt: now,
  });

  return { projectId: normalizedProjectId, builderId: normalizedBuilderId };
};

export const seedEmulatorJob = async ({
  jobId,
  projectId,
  builderId,
  title,
  description = null,
  section = null,
  status = "approved",
  reviewedBy = null,
  reviewedAt = null,
}) => {
  const { projectId: emulatorProjectId } = assertFirestoreEmulatorOnly();
  const normalizedJobId = requireText(jobId, "Job id");
  const normalizedProjectId = requireText(projectId, "Project id");
  const normalizedBuilderId = requireText(builderId, "Builder id");
  const normalizedTitle = requireText(title, "Job title");
  for (const id of [normalizedJobId, normalizedProjectId, normalizedBuilderId]) {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) fail("Job fixture ids are invalid");
  }
  if (!new Set(["approved", "pending", "needs_correction", "waiting_review", "completed"]).has(status)) {
    fail("Job status is invalid");
  }
  if (reviewedAt !== null && (!(reviewedAt instanceof Date) || Number.isNaN(reviewedAt.getTime()))) {
    fail("Job review date is invalid");
  }

  const app = getApps().find((candidate) => candidate.name === EMULATOR_APP_NAME)
    ?? initializeApp({ projectId: emulatorProjectId }, EMULATOR_APP_NAME);
  const now = Timestamp.now();
  await getFirestore(app).collection("jobs").doc(normalizedJobId).create({
    projectId: normalizedProjectId,
    builderId: normalizedBuilderId,
    title: normalizedTitle,
    description: description?.trim() || null,
    section: section?.trim() || null,
    status,
    reviewNotes: null,
    reviewedBy,
    reviewedAt: reviewedAt ? Timestamp.fromDate(reviewedAt) : null,
    createdAt: now,
    updatedAt: now,
  });

  return { jobId: normalizedJobId };
};

export const seedEmulatorTimeEntry = async ({
  entryId,
  projectId,
  builderId,
  clockIn,
  clockOut,
  notes = null,
}) => {
  const { projectId: emulatorProjectId } = assertFirestoreEmulatorOnly();
  const normalizedEntryId = requireText(entryId, "Time entry id");
  const normalizedProjectId = requireText(projectId, "Project id");
  const normalizedBuilderId = requireText(builderId, "Builder id");
  for (const id of [normalizedEntryId, normalizedProjectId, normalizedBuilderId]) {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) fail("Time entry fixture ids are invalid");
  }
  if (!(clockIn instanceof Date) || Number.isNaN(clockIn.getTime())) fail("Clock-in date is invalid");
  if (clockOut !== null && (!(clockOut instanceof Date) || Number.isNaN(clockOut.getTime()))) {
    fail("Clock-out date is invalid");
  }
  if (notes !== null && (typeof notes !== "string" || notes.length > 1_000)) {
    fail("Time entry notes are invalid");
  }

  const app = getApps().find((candidate) => candidate.name === EMULATOR_APP_NAME)
    ?? initializeApp({ projectId: emulatorProjectId }, EMULATOR_APP_NAME);
  await getFirestore(app).collection("timeTracking").doc(normalizedEntryId).create({
    projectId: normalizedProjectId,
    builderId: normalizedBuilderId,
    clockIn: Timestamp.fromDate(clockIn),
    clockOut: clockOut ? Timestamp.fromDate(clockOut) : null,
    location: null,
    // Preserve leading spreadsheet-control characters in test fixtures so CSV
    // injection defenses are exercised against legacy/Admin-authored records.
    notes: notes === "" ? null : notes,
  });

  return { entryId: normalizedEntryId };
};
