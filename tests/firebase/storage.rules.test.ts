import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { doc, serverTimestamp, setDoc, Timestamp } from "firebase/firestore";
import { deleteObject, getBytes, ref, uploadBytes } from "firebase/storage";
import { readFileSync } from "node:fs";

const projectId = "demo-jobsite-jedi";
let testEnv: RulesTestEnvironment;

type AuthorizationRole = "admin" | "manager" | "builder";

const authorizationGrantIds = {
  builder: "1".repeat(32),
  otherBuilder: "2".repeat(32),
  manager: "3".repeat(32),
  admin: "4".repeat(32),
} as const;

const authorizedStorage = (
  uid: string,
  role: AuthorizationRole,
  grantId: string,
  name: string,
) => testEnv.authenticatedContext(uid, {
  role,
  authorizationGrantId: grantId,
  name,
}).storage();

const builderStorage = () =>
  authorizedStorage("builder-1", "builder", authorizationGrantIds.builder, "Builder One");
const otherBuilderStorage = () =>
  authorizedStorage("builder-2", "builder", authorizationGrantIds.otherBuilder, "Builder Two");
const managerStorage = () =>
  authorizedStorage("manager-1", "manager", authorizationGrantIds.manager, "Manager One");
const adminStorage = () =>
  authorizedStorage("admin-1", "admin", authorizationGrantIds.admin, "Admin One");
const invitationPlaceholderStorage = () => testEnv.authenticatedContext("placeholder-1", {
  invitationEnrollmentId: "e".repeat(32),
  name: "Invitation Placeholder",
}).storage();
const builderDb = () =>
  testEnv.authenticatedContext("builder-1", {
    role: "builder",
    authorizationGrantId: authorizationGrantIds.builder,
    name: "Builder One",
  }).firestore();
const anonymousStorage = () => testEnv.unauthenticatedContext().storage();

const image = () => new Blob(["image-content"], { type: "image/jpeg" });

const seedAuthorizationGrant = async (
  uid: string,
  role: AuthorizationRole,
  grantId: string,
  active = true,
) => {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), `authorizationGrants/${uid}`), {
      active,
      role,
      grantId,
      updatedAt: Timestamp.now(),
    });
  });
};

const seedValidAuthorizationGrants = async () => {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await Promise.all([
      setDoc(doc(db, "authorizationGrants/builder-1"), {
        active: true,
        role: "builder",
        grantId: authorizationGrantIds.builder,
        updatedAt: Timestamp.now(),
      }),
      setDoc(doc(db, "authorizationGrants/builder-2"), {
        active: true,
        role: "builder",
        grantId: authorizationGrantIds.otherBuilder,
        updatedAt: Timestamp.now(),
      }),
      setDoc(doc(db, "authorizationGrants/manager-1"), {
        active: true,
        role: "manager",
        grantId: authorizationGrantIds.manager,
        updatedAt: Timestamp.now(),
      }),
      setDoc(doc(db, "authorizationGrants/admin-1"), {
        active: true,
        role: "admin",
        grantId: authorizationGrantIds.admin,
        updatedAt: Timestamp.now(),
      }),
    ]);
  });
};

const seedProject = async (seedProjectId: string, builderId = "builder-1") => {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), `projects/${seedProjectId}`), {
      builderId,
      ownerId: builderId,
      createdBy: "manager-1",
      name: `Project ${seedProjectId}`,
      description: null,
      clientName: "QA client",
      address: null,
      status: "active",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  });
};

const seedAssignedJob = async (
  jobId: string,
  status: "approved" | "waiting_review" | "completed" = "approved",
  builderId = "builder-1",
) => {
  const seedProjectId = `${jobId}-project`;
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, `projects/${seedProjectId}`), {
      builderId,
      ownerId: builderId,
      createdBy: "manager-1",
      name: `Project ${seedProjectId}`,
      description: null,
      clientName: "QA client",
      address: null,
      status: "active",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    await setDoc(doc(db, `jobs/${jobId}`), {
      projectId: seedProjectId,
      builderId,
      title: `Job ${jobId}`,
      description: null,
      section: null,
      status,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  });
};

const setJobStatus = async (jobId: string, status: "waiting_review" | "completed") => {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), `jobs/${jobId}`), { status }, { merge: true });
  });
};

describe("Firebase Storage authorization rules", () => {
  beforeAll(async () => {
    testEnv = await initializeTestEnvironment({
      projectId,
      storage: {
        host: "127.0.0.1",
        port: 9199,
        rules: readFileSync("storage.rules", "utf8"),
      },
      firestore: {
        host: "127.0.0.1",
        port: 8080,
        rules: readFileSync("firestore.rules", "utf8"),
      },
    });
    await seedValidAuthorizationGrants();
  });

  afterAll(async () => {
    await testEnv.cleanup();
  });

  test("does not treat an invitation enrollment marker as a Storage role", async () => {
    await seedAssignedJob("job-placeholder", "approved", "placeholder-1");
    const path = "jobs/job-placeholder/placeholder-1/reference/photo.jpg";

    await assertFails(uploadBytes(ref(invitationPlaceholderStorage(), path), await image()));
    await assertFails(getBytes(ref(invitationPlaceholderStorage(), path)));
  });

  test("rejects Storage roles without a grant document or with an inactive grant", async () => {
    const missingUid = "manager-storage-missing-grant";
    const missingGrantId = "5".repeat(32);
    const inactiveUid = "manager-storage-inactive-grant";
    const inactiveGrantId = "6".repeat(32);
    const csv = new Blob(["Title\nAuthorization probe"], { type: "text/csv" });
    await seedAuthorizationGrant(inactiveUid, "manager", inactiveGrantId, false);

    await assertFails(uploadBytes(
      ref(
        authorizedStorage(missingUid, "manager", missingGrantId, "Missing Grant Manager"),
        `job-imports/${missingUid}/jobs.csv`,
      ),
      csv,
    ));
    await assertFails(uploadBytes(
      ref(
        authorizedStorage(inactiveUid, "manager", inactiveGrantId, "Inactive Grant Manager"),
        `job-imports/${inactiveUid}/jobs.csv`,
      ),
      csv,
    ));
  });

  test("rejects Storage role and grant identifiers that do not match the server registry", async () => {
    const roleMismatchUid = "manager-storage-role-mismatch";
    const roleMismatchGrantId = "7".repeat(32);
    const grantMismatchUid = "manager-storage-id-mismatch";
    const tokenGrantId = "8".repeat(32);
    const csv = new Blob(["Title\nAuthorization probe"], { type: "text/csv" });
    await seedAuthorizationGrant(roleMismatchUid, "builder", roleMismatchGrantId);
    await seedAuthorizationGrant(grantMismatchUid, "manager", "9".repeat(32));

    await assertFails(uploadBytes(
      ref(
        authorizedStorage(
          roleMismatchUid,
          "manager",
          roleMismatchGrantId,
          "Role Mismatch Manager",
        ),
        `job-imports/${roleMismatchUid}/jobs.csv`,
      ),
      csv,
    ));
    await assertFails(uploadBytes(
      ref(
        authorizedStorage(grantMismatchUid, "manager", tokenGrantId, "Grant Mismatch Manager"),
        `job-imports/${grantMismatchUid}/jobs.csv`,
      ),
      csv,
    ));
  });

  test("revokes Storage access from an old token after its authorization grant rotates", async () => {
    const uid = "manager-storage-rotated-grant";
    const oldGrantId = "a".repeat(32);
    const newGrantId = "b".repeat(32);
    const path = `job-imports/${uid}/jobs.csv`;
    const staleStorage = authorizedStorage(uid, "manager", oldGrantId, "Rotated Grant Manager");
    const csv = new Blob(["Title\nAuthorization probe"], { type: "text/csv" });
    await seedAuthorizationGrant(uid, "manager", oldGrantId);

    await assertSucceeds(uploadBytes(ref(staleStorage, path), csv));

    await seedAuthorizationGrant(uid, "manager", newGrantId);

    await assertFails(getBytes(ref(staleStorage, path)));
    await assertSucceeds(getBytes(ref(
      authorizedStorage(uid, "manager", newGrantId, "Rotated Grant Manager"),
      path,
    )));
  });

  test("allows only the assigned builder to create a job image and forbids overwrite", async () => {
    await seedAssignedJob("job-1");
    const path = "jobs/job-1/builder-1/reference/photo.jpg";
    await assertSucceeds(uploadBytes(ref(builderStorage(), path), await image()));
    const bytes = await assertSucceeds(getBytes(ref(builderStorage(), path)));
    expect(new TextDecoder().decode(bytes)).toBe("image-content");
    await assertFails(uploadBytes(ref(builderStorage(), path), await image()));
  });

  test("blocks anonymous and cross-builder access", async () => {
    await seedAssignedJob("job-2");
    const path = "jobs/job-2/builder-1/reference/photo.jpg";
    await assertFails(uploadBytes(ref(anonymousStorage(), path), await image()));
    await assertSucceeds(uploadBytes(ref(builderStorage(), path), await image()));
    await assertFails(getBytes(ref(otherBuilderStorage(), path)));
    await assertFails(uploadBytes(
      ref(builderStorage(), "jobs/missing-job/builder-1/reference/photo.jpg"),
      await image(),
    ));
  });

  test("limits manager feedback to the review window and locks bytes after completion", async () => {
    await seedAssignedJob("job-3", "waiting_review");
    const path = "jobs/job-3/builder-1/feedback/photo.jpg";
    await assertSucceeds(uploadBytes(ref(managerStorage(), path), await image()));
    await assertSucceeds(getBytes(ref(managerStorage(), path)));
    await assertSucceeds(getBytes(ref(builderStorage(), path)));
    await assertFails(getBytes(ref(otherBuilderStorage(), path)));
    await setJobStatus("job-3", "completed");
    await assertFails(deleteObject(ref(managerStorage(), path)));
    await assertFails(uploadBytes(
      ref(managerStorage(), "jobs/job-3/builder-1/feedback/late.jpg"),
      await image(),
    ));
  });

  test("allows admin to inherit manager file operations", async () => {
    await seedAssignedJob("admin-feedback-job", "waiting_review");
    const feedback = ref(
      adminStorage(),
      "jobs/admin-feedback-job/builder-1/feedback/admin-feedback.jpg",
    );

    await assertSucceeds(uploadBytes(feedback, image()));
    await assertSucceeds(getBytes(feedback));
    await assertSucceeds(deleteObject(feedback));
  });

  test("restricts manager-only paths to the builder assigned to the job", async () => {
    await seedAssignedJob("job-manager-path", "waiting_review");
    const path = "jobs/job-manager-path/manager/feedback/photo.jpg";
    await assertSucceeds(uploadBytes(ref(managerStorage(), path), await image()));
    await assertSucceeds(getBytes(ref(builderStorage(), path)));
    await assertFails(getBytes(ref(otherBuilderStorage(), path)));
  });

  test("scopes reports and documents while preserving owner access to other private roots", async () => {
    await seedProject("report-storage-project");
    await assertSucceeds(setDoc(doc(builderDb(), "dailyReports/report-storage-1"), {
      builderId: "builder-1",
      projectId: "report-storage-project",
      date: "2026-08-28",
      description: "Private report",
      photoPaths: [],
      createdAt: serverTimestamp(),
    }));
    await assertSucceeds(uploadBytes(
      ref(builderStorage(), "dailyReports/builder-1/report-storage-1/photo.jpg"),
      await image(),
    ));
    await assertFails(getBytes(ref(otherBuilderStorage(), "dailyReports/builder-1/report-storage-1/photo.jpg")));

    await assertSucceeds(uploadBytes(
      ref(managerStorage(), "documents/report-storage-project/document-1/file.bin"),
      await image(),
    ));
    await assertSucceeds(getBytes(ref(builderStorage(), "documents/report-storage-project/document-1/file.bin")));
    await assertFails(getBytes(ref(otherBuilderStorage(), "documents/report-storage-project/document-1/file.bin")));
    await assertFails(uploadBytes(
      ref(builderStorage(), "documents/report-storage-project/document-2/file.bin"),
      await image(),
    ));

    for (const root of ["materials", "voiceNotes"]) {
      await assertSucceeds(
        uploadBytes(ref(builderStorage(), `${root}/builder-1/file.bin`), await image()),
      );
    }
  });

  test("keeps invoice uploads quarantined until server promotion", async () => {
    const quarantinePath = "invoice-quarantine/builder-1/invoice-storage-1/upload";
    const finalPath = "invoices/builder-1/invoice-storage-1/invoice.pdf";
    const pdf = new Blob(["invoice-pdf"], { type: "application/pdf" });
    await assertSucceeds(uploadBytes(ref(builderStorage(), quarantinePath), pdf));
    await assertFails(getBytes(ref(builderStorage(), quarantinePath)));
    await assertFails(uploadBytes(ref(builderStorage(), quarantinePath), pdf));
    await assertFails(uploadBytes(ref(builderStorage(), finalPath), pdf));

    await testEnv.withSecurityRulesDisabled(async (context) => {
      await uploadBytes(ref(context.storage(), finalPath), pdf);
    });
    await assertSucceeds(getBytes(ref(builderStorage(), finalPath)));
    await assertSucceeds(getBytes(ref(managerStorage(), finalPath)));
    await assertFails(getBytes(ref(otherBuilderStorage(), finalPath)));

    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), "invoices/invoice-storage-1"), {
        uploadedBy: "builder-1",
        filePath: finalPath,
        status: "submitted",
      });
    });
    await assertFails(deleteObject(ref(builderStorage(), quarantinePath)));
    await assertFails(deleteObject(ref(builderStorage(), finalPath)));
    await assertFails(uploadBytes(ref(builderStorage(), finalPath), pdf));
  });

  test("enforces the invoice quarantine limit at the exact 10 MB boundary", async () => {
    const justBelowLimit = new Blob(
      [new Uint8Array(10 * 1024 * 1024 - 1)],
      { type: "application/pdf" },
    );
    const atLimit = new Blob(
      [new Uint8Array(10 * 1024 * 1024)],
      { type: "application/pdf" },
    );

    await assertSucceeds(uploadBytes(
      ref(builderStorage(), "invoice-quarantine/builder-1/invoice-boundary-ok/upload"),
      justBelowLimit,
    ));
    await assertFails(uploadBytes(
      ref(builderStorage(), "invoice-quarantine/builder-1/invoice-boundary-rejected/upload"),
      atLimit,
    ));
  });

  test("restricts spreadsheet imports to the owning manager", async () => {
    const path = "job-imports/manager-1/jobs.csv";
    const csv = new Blob(["Title,Section\nInstall vanity,Bathroom"], { type: "text/csv" });
    await assertSucceeds(uploadBytes(ref(managerStorage(), path), csv));
    await assertSucceeds(getBytes(ref(managerStorage(), path)));
    await assertFails(getBytes(ref(builderStorage(), path)));
    await assertFails(uploadBytes(
      ref(builderStorage(), "job-imports/builder-1/jobs.csv"),
      csv,
    ));
  });

  test("keeps rubbish evidence immutable after its request is created", async () => {
    const orphanPath = "rubbish/builder-1/orphan-request/photo.jpg";
    await assertSucceeds(uploadBytes(ref(builderStorage(), orphanPath), await image()));
    await assertSucceeds(deleteObject(ref(builderStorage(), orphanPath)));

    const path = "rubbish/builder-1/request-locked/photo.jpg";
    await assertSucceeds(uploadBytes(ref(builderStorage(), path), await image()));
    await seedProject("rubbish-project");
    await assertSucceeds(setDoc(doc(builderDb(), "rubbishCollectionRequests/request-locked"), {
      userId: "builder-1",
      requestedByName: "Builder One",
      projectId: "rubbish-project",
      photoPaths: [path],
      description: null,
      status: "pending",
      createdAt: serverTimestamp(),
      resolvedAt: null,
      resolvedBy: null,
    }));
    await assertFails(deleteObject(ref(builderStorage(), path)));
    await assertFails(uploadBytes(ref(builderStorage(), path), await image()));
  });

  test("rejects unsupported uploads and unknown top-level paths", async () => {
    await seedAssignedJob("job-4");
    const pdf = new Blob(["not-an-image"], { type: "text/plain" });
    await assertFails(
      uploadBytes(
        ref(builderStorage(), "jobs/job-4/builder-1/reference/file.txt"),
        pdf,
      ),
    );
    await assertFails(
      uploadBytes(ref(builderStorage(), "private/builder-1/file.jpg"), await image()),
    );
    await assertFails(
      uploadBytes(ref(builderStorage(), "rubbish/builder-1/request-1/file.txt"), pdf),
    );
    await assertFails(
      uploadBytes(
        ref(builderStorage(), "invoices/builder-1/invoice-invalid/file.txt"),
        pdf,
      ),
    );
  });
});
