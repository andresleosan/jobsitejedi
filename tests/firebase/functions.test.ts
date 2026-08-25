import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { collection, doc } from "firebase/firestore";

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
let createProject: typeof import("@/lib/firebase/repositories/projects").createProject;
let uploadPrivateFile: typeof import("@/lib/firebase/storage").uploadPrivateFile;
let buildPrivateStoragePath: typeof import("@/lib/firebase/storage").buildPrivateStoragePath;
let firebaseDb: typeof import("@/lib/firebase/client").firebaseDb;

describe("Firebase invitation Functions", () => {
  beforeAll(async () => {
    vi.stubEnv("VITE_FIREBASE_USE_EMULATORS", "true");
    const [{ getApps, initializeApp }, { getAuth }] = await Promise.all([
      import("../../functions/node_modules/firebase-admin/lib/app/index.js"),
      import("../../functions/node_modules/firebase-admin/lib/auth/index.js"),
    ]);
    const adminApp = getApps().find((app) => app.name === "firebase-invitation-tests")
      ?? initializeApp({ projectId: "demo-jobsite-jedi" }, "firebase-invitation-tests");
    adminAuth = getAuth(adminApp);
    ({ registerBuilder, registerWithInvitation, signIn, signOut } = await import("@/lib/firebase/auth"));
    ({ invitationOperations, submitInvoiceRecord, reviewInvoiceRecord } = await import("@/lib/firebase/functions"));
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
    ).rejects.toMatchObject({ code: "functions/failed-precondition" });
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
});
