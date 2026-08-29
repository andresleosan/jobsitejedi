import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { collection, doc, getDoc } from "firebase/firestore";
import { createHash } from "node:crypto";

const credentials = (label: string) => ({
  email: `functions-${label}-${Date.now()}@example.test`,
  password: "Valid-password-123!",
  fullName: `Functions ${label}`,
});

let adminAuth: typeof import("../../functions/node_modules/firebase-admin/lib/auth/index.js").getAuth extends (
  ...args: infer Args
) => infer Result
  ? (...args: Args) => Result
  : never;
let registerBuilder: typeof import("@/lib/firebase/auth").registerBuilder;
let registerWithInvitation: typeof import("@/lib/firebase/auth").registerWithInvitation;
let signIn: typeof import("@/lib/firebase/auth").signIn;
let signOut: typeof import("@/lib/firebase/auth").signOut;
let invitationOperations: typeof import("@/lib/firebase/functions").invitationOperations;
let submitInvoiceRecord: typeof import("@/lib/firebase/functions").submitInvoiceRecord;
let reviewInvoiceRecord: typeof import("@/lib/firebase/functions").reviewInvoiceRecord;
let extractJobsFromExcelRecord: typeof import("@/lib/firebase/functions").extractJobsFromExcelRecord;
let createProject: typeof import("@/lib/firebase/repositories/projects").createProject;
let uploadPrivateFile: typeof import("@/lib/firebase/storage").uploadPrivateFile;
let buildPrivateStoragePath: typeof import("@/lib/firebase/storage").buildPrivateStoragePath;
let firebaseDb: typeof import("@/lib/firebase/client").firebaseDb;
let clearPublicInvitationRateLimit: () => Promise<void>;

describe("Firebase invitation Functions", () => {
  beforeAll(async () => {
    vi.stubEnv("VITE_FIREBASE_USE_EMULATORS", "true");
    const [{ getApps, initializeApp }, { getAuth }, { getFirestore }] = await Promise.all([
      import("../../functions/node_modules/firebase-admin/lib/app/index.js"),
      import("../../functions/node_modules/firebase-admin/lib/auth/index.js"),
      import("../../functions/node_modules/firebase-admin/lib/firestore/index.js"),
    ]);
    const adminApp = getApps().find((app) => app.name === "firebase-invitation-tests")
      ?? initializeApp({ projectId: "demo-jobsite-jedi" }, "firebase-invitation-tests");
    adminAuth = getAuth(adminApp);
    const adminDb = getFirestore(adminApp);
    const publicRateLimitId = createHash("sha256")
      .update("validateInvitationCode:public")
      .digest("hex");
    clearPublicInvitationRateLimit = () => adminDb
      .collection("functionRateLimits")
      .doc(publicRateLimitId)
      .delete();
    ({ registerBuilder, registerWithInvitation, signIn, signOut } = await import("@/lib/firebase/auth"));
    ({ invitationOperations, submitInvoiceRecord, reviewInvoiceRecord, extractJobsFromExcelRecord } =
      await import("@/lib/firebase/functions"));
    ({ createProject } = await import("@/lib/firebase/repositories/projects"));
    ({ uploadPrivateFile, buildPrivateStoragePath } = await import("@/lib/firebase/storage"));
    ({ firebaseDb } = await import("@/lib/firebase/client"));
  });

  afterAll(async () => {
    await signOut();
    vi.unstubAllEnvs();
  });

  test("creates, validates, consumes once and rejects a second consumption", async () => {
    const managerCredentials = credentials("manager");
    const manager = await registerBuilder(managerCredentials);
    await adminAuth.setCustomUserClaims(manager.id, { role: "manager" });
    await signOut();
    await signIn(managerCredentials.email, managerCredentials.password);

    const invitation = await invitationOperations.createInvitation({ role: "builder" });
    expect(invitation.code).toMatch(/^[A-Z0-9]{12}$/);
    const validation = await invitationOperations.validateInvitationCode(invitation.code);
    expect(validation).toMatchObject({ valid: true, role: "builder" });

    await signOut();
    const builderCredentials = credentials("invited-builder");
    const invitedBuilder = await registerWithInvitation({
      ...builderCredentials,
      invitationId: validation.invitationId,
    });
    expect(invitedBuilder.role).toBe("builder");

    await expect(
      invitationOperations.consumeInvitation({
        invitationId: validation.invitationId,
        userId: invitedBuilder.id,
      }),
    ).resolves.toBeUndefined();
  }, 15_000);

  test("submits an invoice idempotently and restricts review to managers", async () => {
    const builderCredentials = credentials("invoice-builder");
    const builder = await registerBuilder(builderCredentials);
    const project = await createProject({
      name: "Functions invoice project",
      clientName: "Invoice client",
    });
    const invoiceId = doc(collection(firebaseDb, "invoices")).id;
    const filePath = buildPrivateStoragePath("invoices", builder.id, invoiceId, "invoice.png");
    await uploadPrivateFile(
      filePath,
      new Blob(["invoice-image"], { type: "image/png" }),
      { contentType: "image/png" },
    );
    const payload = {
      invoiceId,
      projectId: project.id,
      invoiceNumber: "INV-FN-100",
      supplierName: "Functions Supplier",
      invoiceDate: "2026-08-24",
      totalAmountMinor: 45_678,
      currency: "GBP" as const,
      notes: "Callable integration fixture",
      filePath,
      fileName: "invoice.png",
    };

    await expect(submitInvoiceRecord(payload)).resolves.toEqual({ invoiceId, status: "submitted" });
    await expect(submitInvoiceRecord(payload)).resolves.toEqual({ invoiceId, status: "submitted" });
    await expect(submitInvoiceRecord({ ...payload, totalAmountMinor: 0 })).rejects.toMatchObject({
      code: "functions/invalid-argument",
    });
    await expect(reviewInvoiceRecord({
      invoiceId,
      status: "approved",
      reviewNotes: "Builder cannot approve",
    })).rejects.toMatchObject({ code: "functions/permission-denied" });

    await signOut();
    const managerCredentials = credentials("invoice-manager");
    const manager = await registerBuilder(managerCredentials);
    await adminAuth.setCustomUserClaims(manager.id, { role: "manager" });
    await signOut();
    await signIn(managerCredentials.email, managerCredentials.password);

    const review = { invoiceId, status: "approved" as const, reviewNotes: "Matched to project" };
    await expect(reviewInvoiceRecord(review)).resolves.toEqual({ invoiceId, status: "approved" });
    await expect(reviewInvoiceRecord(review)).resolves.toEqual({ invoiceId, status: "approved" });
    await expect(reviewInvoiceRecord({ ...review, status: "rejected" })).rejects.toMatchObject({
      code: "functions/failed-precondition",
    });
  }, 20_000);

  test("rate-limits repeated manager invitation requests per user", async () => {
    const managerCredentials = credentials("rate-limit-manager");
    const manager = await registerBuilder(managerCredentials);
    await adminAuth.setCustomUserClaims(manager.id, { role: "manager" });
    await signOut();
    await signIn(managerCredentials.email, managerCredentials.password);

    for (let attempt = 0; attempt < 10; attempt += 1) {
      await expect(invitationOperations.createInvitation({ role: "builder" })).resolves.toBeDefined();
    }
    await expect(invitationOperations.createInvitation({ role: "builder" })).rejects.toMatchObject({
      code: "functions/resource-exhausted",
    });
  }, 20_000);

  test("rate-limits public invitation validation before unbounded Firestore lookups", async () => {
    await signOut();
    await clearPublicInvitationRateLimit();

    try {
      for (let attempt = 0; attempt < 30; attempt += 1) {
        await expect(
          invitationOperations.validateInvitationCode("000000000000"),
        ).resolves.toMatchObject({ valid: false });
      }
      await expect(
        invitationOperations.validateInvitationCode("000000000000"),
      ).rejects.toMatchObject({ code: "functions/resource-exhausted" });
    } finally {
      await clearPublicInvitationRateLimit();
    }
  }, 20_000);

  test("imports spreadsheet jobs idempotently for managers", async () => {
    const managerCredentials = credentials("spreadsheet-manager");
    const manager = await registerBuilder(managerCredentials);
    await adminAuth.setCustomUserClaims(manager.id, { role: "manager" });
    await signOut();
    await signIn(managerCredentials.email, managerCredentials.password);

    const project = await createProject({
      name: "Spreadsheet import project",
      clientName: "Spreadsheet client",
    });
    const filePath = `job-imports/${manager.id}/jobs.csv`;
    await uploadPrivateFile(
      filePath,
      new Blob([
        "Title,Description,Section\nInstall vanity,Double sink,Bathroom\nPaint walls,,Living Room",
      ], { type: "text/csv" }),
      { contentType: "text/csv" },
    );

    const first = await extractJobsFromExcelRecord({ projectId: project.id, filePath });
    const second = await extractJobsFromExcelRecord({ projectId: project.id, filePath });
    expect(first.createdJobIds).toHaveLength(2);
    expect(second).toEqual(first);
    const importedJob = await getDoc(doc(firebaseDb, "jobs", first.createdJobIds[0]));
    expect(importedJob.exists()).toBe(true);
  }, 30_000);
});
