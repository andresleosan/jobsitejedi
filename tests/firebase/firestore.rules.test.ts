import {
  afterAll,
  beforeAll,
  describe,
  test,
} from "vitest";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  writeBatch,
} from "firebase/firestore";
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

const authorizedDb = (
  uid: string,
  role: AuthorizationRole,
  grantId: string,
  name: string,
) => testEnv.authenticatedContext(uid, {
  role,
  authorizationGrantId: grantId,
  name,
}).firestore();

const builderDb = () =>
  authorizedDb("builder-1", "builder", authorizationGrantIds.builder, "Builder One");
const otherBuilderDb = () =>
  authorizedDb("builder-2", "builder", authorizationGrantIds.otherBuilder, "Builder Two");
const managerDb = () =>
  authorizedDb("manager-1", "manager", authorizationGrantIds.manager, "Manager One");
const adminDb = () =>
  authorizedDb("admin-1", "admin", authorizationGrantIds.admin, "Admin One");
const invitationPlaceholderDb = () => testEnv.authenticatedContext("placeholder-1", {
  invitationEnrollmentId: "e".repeat(32),
  name: "Invitation Placeholder",
}).firestore();
const anonymousDb = () => testEnv.unauthenticatedContext().firestore();

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

const validSupplierData = (uid: string, normalizedName: string) => ({
  name: `Authorization probe ${normalizedName}`,
  normalizedName,
  createdBy: uid,
  createdAt: serverTimestamp(),
  updatedAt: serverTimestamp(),
});

const seedProject = async (
  id: string,
  builderId = "builder-1",
  name = "Rules project",
) => {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), `projects/${id}`), {
      builderId,
      ownerId: builderId,
      createdBy: "manager-1",
      name,
      description: null,
      clientName: "Rules client",
      address: null,
      status: "active",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  });
};

const seedInvitation = async (id: string, role: "admin" | "manager" | "builder" = "admin") => {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const expiresAt = Timestamp.fromMillis(Date.now() + 30 * 60 * 1000);
    await setDoc(doc(context.firestore(), `invitations/${id}`), {
      schemaVersion: 4,
      codeHash: "a".repeat(64),
      targetEmailHash: "b".repeat(64),
      targetEmailSalt: "c".repeat(32),
      targetLockId: "d".repeat(64),
      targetUid: "placeholder-1",
      targetEnrollmentHash: "e".repeat(64),
      requestKeyHash: "f".repeat(64),
      generation: 1,
      encryptedCode: "A".repeat(16),
      codeEncryptionIv: "B".repeat(16),
      codeEncryptionTag: "C".repeat(22),
      role,
      status: "pending",
      claimAssignmentState: "not_started",
      createdBy: "admin-1",
      createdByRole: "admin",
      createdAt: Timestamp.now(),
      expiresAt,
      usedBy: null,
      usedAt: null,
      claimAssignedAt: null,
    });
    await setDoc(doc(context.firestore(), `invitationTargets/${"d".repeat(64)}`), {
      invitationId: id,
      requestKeyHash: "f".repeat(64),
      generation: 1,
      status: "pending",
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
      expiresAt,
    });
  });
};

const validJobData = (projectId: string, builderId = "builder-1") => ({
  projectId,
  builderId,
  title: "Rules job",
  description: null,
  section: null,
  status: "approved",
  createdAt: serverTimestamp(),
  updatedAt: serverTimestamp(),
});

describe("Firestore authorization rules", () => {
  beforeAll(async () => {
    testEnv = await initializeTestEnvironment({
      projectId,
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

  test("does not treat an invitation enrollment marker as authorization", async () => {
    await seedProject("project-placeholder-denied");
    await seedInvitation("invitation-placeholder-denied", "builder");
    const placeholder = invitationPlaceholderDb();

    await assertFails(getDoc(doc(placeholder, "projects/project-placeholder-denied")));
    await assertFails(getDoc(doc(placeholder, "invitations/invitation-placeholder-denied")));
    await assertFails(getDoc(doc(placeholder, `invitationTargets/${"d".repeat(64)}`)));
    await assertFails(setDoc(doc(placeholder, "projects/placeholder-forged"), {
      builderId: "placeholder-1",
      ownerId: "placeholder-1",
      createdBy: "placeholder-1",
      name: "Forged project",
    }));
  });

  test("rejects role claims without a grant document or with an inactive grant", async () => {
    const missingUid = "manager-missing-grant";
    const missingGrantId = "5".repeat(32);
    const inactiveUid = "manager-inactive-grant";
    const inactiveGrantId = "6".repeat(32);
    await seedAuthorizationGrant(inactiveUid, "manager", inactiveGrantId, false);

    await assertFails(setDoc(
      doc(
        authorizedDb(missingUid, "manager", missingGrantId, "Missing Grant Manager"),
        "suppliers/authz-missing-grant",
      ),
      validSupplierData(missingUid, "authz-missing-grant"),
    ));
    await assertFails(setDoc(
      doc(
        authorizedDb(inactiveUid, "manager", inactiveGrantId, "Inactive Grant Manager"),
        "suppliers/authz-inactive-grant",
      ),
      validSupplierData(inactiveUid, "authz-inactive-grant"),
    ));
  });

  test("rejects role and grant identifiers that do not match the server registry", async () => {
    const roleMismatchUid = "manager-role-mismatch";
    const roleMismatchGrantId = "7".repeat(32);
    const grantMismatchUid = "manager-id-mismatch";
    const tokenGrantId = "8".repeat(32);
    await seedAuthorizationGrant(roleMismatchUid, "builder", roleMismatchGrantId);
    await seedAuthorizationGrant(grantMismatchUid, "manager", "9".repeat(32));

    await assertFails(setDoc(
      doc(
        authorizedDb(roleMismatchUid, "manager", roleMismatchGrantId, "Role Mismatch Manager"),
        "suppliers/authz-role-mismatch",
      ),
      validSupplierData(roleMismatchUid, "authz-role-mismatch"),
    ));
    await assertFails(setDoc(
      doc(
        authorizedDb(grantMismatchUid, "manager", tokenGrantId, "Grant Mismatch Manager"),
        "suppliers/authz-id-mismatch",
      ),
      validSupplierData(grantMismatchUid, "authz-id-mismatch"),
    ));
  });

  test("revokes an old token as soon as its authorization grant rotates", async () => {
    const uid = "manager-rotated-grant";
    const oldGrantId = "a".repeat(32);
    const newGrantId = "b".repeat(32);
    const staleDb = authorizedDb(uid, "manager", oldGrantId, "Rotated Grant Manager");
    await seedAuthorizationGrant(uid, "manager", oldGrantId);

    await assertSucceeds(setDoc(
      doc(staleDb, "suppliers/authz-before-rotation"),
      validSupplierData(uid, "authz-before-rotation"),
    ));

    await seedAuthorizationGrant(uid, "manager", newGrantId);

    await assertFails(setDoc(
      doc(staleDb, "suppliers/authz-stale-token"),
      validSupplierData(uid, "authz-stale-token"),
    ));
    await assertSucceeds(setDoc(
      doc(
        authorizedDb(uid, "manager", newGrantId, "Rotated Grant Manager"),
        "suppliers/authz-fresh-token",
      ),
      validSupplierData(uid, "authz-fresh-token"),
    ));
  });

  test("keeps assigned projects server-created and scoped to their builder", async () => {
    const project = doc(builderDb(), "projects/project-owned");
    const data = {
      builderId: "builder-1",
      ownerId: "builder-1",
      createdBy: "manager-1",
      name: "Owned project",
    };

    await assertFails(setDoc(doc(anonymousDb(), project.path), data));
    await assertFails(setDoc(project, data));
    await assertFails(setDoc(doc(managerDb(), project.path), data));
    await seedProject("project-owned", "builder-1", "Owned project");
    await assertSucceeds(getDoc(project));
    await assertFails(getDoc(doc(otherBuilderDb(), project.path)));
    await assertFails(updateDoc(project, { name: "Builder rewrite", updatedAt: serverTimestamp() }));
    await assertSucceeds(updateDoc(doc(managerDb(), project.path), {
      name: "Manager update",
      updatedAt: serverTimestamp(),
    }));
    await assertFails(updateDoc(doc(managerDb(), project.path), {
      builderId: "builder-2",
      ownerId: "builder-2",
      updatedAt: serverTimestamp(),
    }));
  });

  test("blocks a builder from reading or changing another builder's project", async () => {
    await seedProject("project-cross-user", "builder-1", "Protected project");
    const project = doc(managerDb(), "projects/project-cross-user");

    const otherProjectRef = doc(otherBuilderDb(), project.path);
    await assertFails(getDoc(otherProjectRef));
    await assertFails(updateDoc(otherProjectRef, { ownerId: "builder-2" }));
  });

  test("allows admin to inherit manager data operations", async () => {
    await seedProject("admin-managed-project", "builder-1", "Admin managed project");
    const project = doc(adminDb(), "projects/admin-managed-project");

    await assertSucceeds(getDoc(project));
    await assertSucceeds(updateDoc(project, {
      name: "Admin updated project",
      updatedAt: serverTimestamp(),
    }));
    await assertSucceeds(setDoc(doc(adminDb(), "suppliers/admin-supplier"), {
      name: "Admin Supplier",
      normalizedName: "admin-supplier",
      createdBy: "admin-1",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }));
  });

  test("keeps suppliers readable but manager-owned and undeletable", async () => {
    const supplier = doc(managerDb(), "suppliers/jedi-timber-supplies");
    await assertSucceeds(setDoc(supplier, {
      name: "Jedi Timber Supplies",
      normalizedName: "jedi-timber-supplies",
      createdBy: "manager-1",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }));
    await assertSucceeds(getDoc(doc(builderDb(), supplier.path)));
    await assertSucceeds(getDoc(doc(managerDb(), supplier.path)));
    await assertFails(getDoc(doc(anonymousDb(), supplier.path)));
    await assertFails(setDoc(doc(builderDb(), "suppliers/forged-supplier"), {
      name: "Forged supplier",
      normalizedName: "forged-supplier",
      createdBy: "builder-1",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }));
    await assertSucceeds(updateDoc(supplier, { name: "Jedi Timber Supplies Ltd" }));
    await assertFails(deleteDoc(supplier));
  });

  test("keeps the role claim outside user documents", async () => {
    const managerUser = doc(managerDb(), "users/manager-1");
    await assertSucceeds(
      setDoc(managerUser, { uid: "manager-1", displayName: "Manager" }),
    );
    await assertFails(updateDoc(managerUser, { role: "builder" }));
    await assertSucceeds(getDoc(doc(managerDb(), managerUser.path)));
    await assertFails(getDoc(doc(builderDb(), managerUser.path)));
  });

  test("enforces canonical job assignment, schema and review transitions", async () => {
    await seedProject("job-rules-project");
    const managerJob = doc(managerDb(), "jobs/review-transition");
    const builderJob = doc(builderDb(), managerJob.path);

    await assertFails(setDoc(builderJob, validJobData("job-rules-project")));
    await assertFails(setDoc(doc(managerDb(), "jobs/forged-assignment"), {
      ...validJobData("job-rules-project", "builder-2"),
    }));
    await assertFails(setDoc(doc(managerDb(), "jobs/extra-field"), {
      ...validJobData("job-rules-project"),
      privileged: true,
    }));
    await assertSucceeds(setDoc(managerJob, validJobData("job-rules-project")));
    await assertSucceeds(getDoc(builderJob));
    await assertFails(getDoc(doc(otherBuilderDb(), managerJob.path)));

    await assertSucceeds(updateDoc(builderJob, {
      status: "waiting_review",
      updatedAt: serverTimestamp(),
    }));
    await assertFails(updateDoc(builderJob, {
      status: "completed",
      updatedAt: serverTimestamp(),
    }));
    await assertFails(updateDoc(doc(managerDb(), managerJob.path), { title: "Rewritten" }));
    await assertSucceeds(updateDoc(doc(managerDb(), managerJob.path), {
      status: "completed",
      reviewNotes: "Evidence accepted",
      reviewedBy: "manager-1",
      reviewedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }));
    await assertFails(updateDoc(builderJob, {
      status: "waiting_review",
      updatedAt: serverTimestamp(),
    }));
    await assertFails(deleteDoc(doc(managerDb(), managerJob.path)));
  });

  test("keeps legacy job completions read-only", async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), "jobCompletions/completion-1"), {
        jobId: "legacy-job",
        builderId: "builder-1",
        completedAt: serverTimestamp(),
      });
    });

    await assertSucceeds(getDoc(doc(builderDb(), "jobCompletions/completion-1")));
    await assertFails(setDoc(doc(builderDb(), "jobCompletions/direct-builder"), {
      builderId: "builder-1",
    }));
    await assertFails(setDoc(doc(managerDb(), "jobCompletions/direct-manager"), {
      builderId: "builder-1",
    }));
    await assertFails(deleteDoc(doc(managerDb(), "jobCompletions/completion-1")));
  });

  test("binds job photo metadata to an assigned job and locks submitted evidence", async () => {
    await seedProject("photo-rules-project");
    const job = doc(managerDb(), "jobs/photo-rules-job");
    await assertSucceeds(setDoc(job, validJobData("photo-rules-project")));

    const photoData = (photoId: string, kind = "completion") => ({
      jobId: "photo-rules-job",
      builderId: "builder-1",
      uploadedBy: "builder-1",
      kind,
      originalPath: `jobs/photo-rules-job/builder-1/${kind}/${photoId}-evidence.jpg`,
      thumbnailPath: `jobs/photo-rules-job/builder-1/${kind}/thumbnails/${photoId}-evidence.jpg`,
      fileName: "evidence.jpg",
      contentType: "image/jpeg",
      createdAt: serverTimestamp(),
    });

    const draft = doc(builderDb(), "jobPhotos/photo-draft");
    await assertSucceeds(setDoc(draft, photoData("photo-draft")));
    await assertFails(updateDoc(draft, { fileName: "changed.jpg" }));
    await assertFails(setDoc(doc(builderDb(), "jobPhotos/photo-forged-owner"), {
      ...photoData("photo-forged-owner"),
      builderId: "builder-2",
    }));
    await assertFails(setDoc(doc(builderDb(), "jobPhotos/photo-forged-path"), {
      ...photoData("photo-forged-path"),
      originalPath: "jobs/another-job/builder-1/completion/photo-forged-path-evidence.jpg",
    }));
    await assertSucceeds(deleteDoc(draft));

    const submittedPhoto = doc(builderDb(), "jobPhotos/photo-submitted");
    await assertSucceeds(setDoc(submittedPhoto, photoData("photo-submitted")));
    await assertSucceeds(updateDoc(doc(builderDb(), job.path), {
      status: "waiting_review",
      updatedAt: serverTimestamp(),
    }));
    await assertFails(deleteDoc(submittedPhoto));
    await assertFails(setDoc(doc(builderDb(), "jobPhotos/photo-late"), photoData("photo-late")));
  });

  test("requires an atomic active marker and preserves immutable time history", async () => {
    await seedProject("time-rules-project-1");
    await seedProject("time-rules-project-2");
    const db = builderDb();
    const first = doc(db, "timeTracking/time-rules-1");
    const marker = doc(db, "activeTimeEntries/builder-1");
    const firstData = {
      builderId: "builder-1",
      projectId: "time-rules-project-1",
      clockIn: serverTimestamp(),
      clockOut: null,
      location: null,
      notes: null,
    };

    await assertFails(setDoc(first, firstData));
    const startBatch = writeBatch(db);
    startBatch.set(first, firstData);
    startBatch.set(marker, {
      builderId: "builder-1",
      entryId: "time-rules-1",
      projectId: "time-rules-project-1",
      updatedAt: serverTimestamp(),
    });
    await assertSucceeds(startBatch.commit());

    const forged = doc(db, "timeTracking/time-rules-forged");
    const forgedBatch = writeBatch(db);
    forgedBatch.set(forged, {
      ...firstData,
      projectId: "time-rules-project-2",
    });
    forgedBatch.set(marker, {
      builderId: "builder-1",
      entryId: "time-rules-forged",
      projectId: "time-rules-project-2",
      updatedAt: serverTimestamp(),
    });
    await assertFails(forgedBatch.commit());

    const second = doc(db, "timeTracking/time-rules-2");
    const switchBatch = writeBatch(db);
    switchBatch.update(first, { clockOut: serverTimestamp() });
    switchBatch.set(second, {
      ...firstData,
      projectId: "time-rules-project-2",
    });
    switchBatch.set(marker, {
      builderId: "builder-1",
      entryId: "time-rules-2",
      projectId: "time-rules-project-2",
      updatedAt: serverTimestamp(),
    });
    await assertSucceeds(switchBatch.commit());

    await assertFails(updateDoc(first, { clockOut: serverTimestamp() }));
    await assertFails(updateDoc(doc(managerDb(), second.path), { clockOut: serverTimestamp() }));
    await assertFails(deleteDoc(doc(managerDb(), first.path)));
    await assertFails(setDoc(doc(db, "projectSwitches/forged-switch"), {
      builderId: "builder-1",
      fromProjectId: "time-rules-project-1",
      toProjectId: "time-rules-project-2",
      travelEntryId: "forged-switch",
      travelTimeMinutes: null,
      switchedAt: serverTimestamp(),
      arrivedAt: null,
    }));

    const stopBatch = writeBatch(db);
    stopBatch.update(second, { clockOut: serverTimestamp() });
    stopBatch.delete(marker);
    await assertSucceeds(stopBatch.commit());
  }, 15_000);

  test("denies all client reads, lists and writes for invitations", async () => {
    const path = "invitations/invitation-rules-v3";
    const targetPath = `invitationTargets/${"d".repeat(64)}`;
    await seedInvitation("invitation-rules-v3");

    await assertFails(getDoc(doc(managerDb(), path)));
    await assertFails(getDocs(collection(managerDb(), "invitations")));
    await assertFails(getDoc(doc(adminDb(), path)));
    await assertFails(getDocs(collection(adminDb(), "invitations")));
    await assertFails(getDoc(doc(builderDb(), path)));
    await assertFails(getDoc(doc(anonymousDb(), path)));
    await assertFails(getDoc(doc(managerDb(), targetPath)));
    await assertFails(getDocs(collection(adminDb(), "invitationTargets")));
    await assertFails(getDoc(doc(builderDb(), targetPath)));
    await assertFails(getDoc(doc(anonymousDb(), targetPath)));

    await assertFails(setDoc(doc(managerDb(), "invitations/manager-forged"), {
      schemaVersion: 4,
      role: "admin",
      status: "pending",
    }));
    await assertFails(setDoc(doc(adminDb(), "invitations/admin-forged"), {
      schemaVersion: 4,
      role: "admin",
      status: "pending",
    }));
    await assertFails(updateDoc(doc(managerDb(), path), { role: "admin" }));
    await assertFails(updateDoc(doc(adminDb(), path), { status: "used", usedBy: "admin-1" }));
    await assertFails(deleteDoc(doc(managerDb(), path)));
    await assertFails(deleteDoc(doc(adminDb(), path)));
    await assertFails(setDoc(doc(managerDb(), "invitationTargets/manager-forged"), {
      invitationId: "manager-forged",
      status: "pending",
    }));
    await assertFails(setDoc(doc(adminDb(), "invitationTargets/admin-forged"), {
      invitationId: "admin-forged",
      status: "pending",
    }));
    await assertFails(deleteDoc(doc(adminDb(), targetPath)));
  });

  test("keeps invoice records server-written and isolates financial data", async () => {
    const path = "invoices/invoice-rules-1";
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), path), {
        projectId: "project-owned",
        uploadedBy: "builder-1",
        status: "submitted",
        totalAmountMinor: 12_345,
      });
    });

    await assertSucceeds(getDoc(doc(builderDb(), path)));
    await assertSucceeds(getDoc(doc(managerDb(), path)));
    await assertFails(getDoc(doc(otherBuilderDb(), path)));
    await assertFails(getDoc(doc(anonymousDb(), path)));
    await assertFails(setDoc(doc(builderDb(), "invoices/direct-write"), {
      uploadedBy: "builder-1",
      totalAmountMinor: 1,
    }));
    await assertFails(updateDoc(doc(builderDb(), path), { totalAmountMinor: 1 }));
    await assertFails(updateDoc(doc(managerDb(), path), { status: "approved" }));
    await assertFails(deleteDoc(doc(managerDb(), path)));
  });

  test("keeps access requests server-only", async () => {
    const path = "accessRequests/access-request-rules-1";
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), path), {
        schemaVersion: 1,
        uid: "access-request-rules-1",
        email: "requester@example.com",
        requestedRole: "builder",
        status: "pending",
      });
    });

    await assertFails(getDoc(doc(adminDb(), path)));
    await assertFails(getDocs(collection(adminDb(), "accessRequests")));
    await assertFails(getDoc(doc(anonymousDb(), path)));
    await assertFails(setDoc(doc(adminDb(), "accessRequests/admin-forged"), { status: "approved" }));
    await assertFails(deleteDoc(doc(adminDb(), path)));
  });

  test("keeps daily reports and risk signatures scoped to the project owner", async () => {
    await seedProject("report-rules-project", "builder-1", "Report rules project");
    await assertSucceeds(setDoc(doc(builderDb(), "dailyReports/report-rules-1"), {
      builderId: "builder-1",
      projectId: "report-rules-project",
      date: "2026-08-28",
      description: "Daily progress",
      photoPaths: [],
      createdAt: serverTimestamp(),
    }));
    await assertSucceeds(getDoc(doc(builderDb(), "dailyReports/report-rules-1")));
    await assertFails(getDoc(doc(otherBuilderDb(), "dailyReports/report-rules-1")));
    await assertFails(setDoc(doc(builderDb(), "dailyReports/forged-report"), {
      builderId: "builder-1",
      projectId: "missing-project",
      date: "2026-08-28",
      description: "Forged report",
      photoPaths: [],
      createdAt: serverTimestamp(),
    }));
    await assertFails(updateDoc(doc(builderDb(), "dailyReports/report-rules-1"), {
      description: "Changed report",
    }));

    await assertSucceeds(setDoc(doc(managerDb(), "riskAssessments/risk-rules-1"), {
      projectId: "report-rules-project",
      title: "Site risk assessment",
      filePath: "documents/report-rules-project/risk-rules-1/assessment.pdf",
      fileName: "assessment.pdf",
      contentType: "application/pdf",
      fileSize: 100,
      uploadedBy: "manager-1",
      createdAt: serverTimestamp(),
    }));
    await assertSucceeds(getDoc(doc(builderDb(), "riskAssessments/risk-rules-1")));
    await assertFails(getDoc(doc(otherBuilderDb(), "riskAssessments/risk-rules-1")));
    await assertFails(setDoc(doc(builderDb(), "riskAssessments/builder-forged"), {
      projectId: "report-rules-project",
      title: "Builder forged assessment",
      filePath: "documents/report-rules-project/builder-forged/assessment.pdf",
      fileName: "assessment.pdf",
      contentType: "application/pdf",
      fileSize: 100,
      uploadedBy: "builder-1",
      createdAt: serverTimestamp(),
    }));
    await assertSucceeds(setDoc(doc(managerDb(), "riskAssessments/risk-rules-2"), {
      projectId: "report-rules-project",
      title: "Second site risk assessment",
      filePath: "documents/report-rules-project/risk-rules-2/assessment.pdf",
      fileName: "assessment.pdf",
      contentType: "application/pdf",
      fileSize: 100,
      uploadedBy: "manager-1",
      createdAt: serverTimestamp(),
    }));

    await assertSucceeds(setDoc(doc(builderDb(), "riskAssessmentSignatures/risk-rules-1_builder-1"), {
      riskAssessmentId: "risk-rules-1",
      userId: "builder-1",
      signedAt: serverTimestamp(),
    }));
    await assertSucceeds(getDoc(doc(builderDb(), "riskAssessmentSignatures/risk-rules-1_builder-1")));
    await assertFails(getDoc(doc(otherBuilderDb(), "riskAssessmentSignatures/risk-rules-1_builder-1")));
    await assertFails(setDoc(doc(builderDb(), "riskAssessmentSignatures/forged-signature"), {
      riskAssessmentId: "risk-rules-1",
      userId: "builder-1",
      signedAt: serverTimestamp(),
    }));
    await assertFails(setDoc(doc(builderDb(), "riskAssessmentSignatures/risk-rules-1_builder-2"), {
      riskAssessmentId: "risk-rules-1",
      userId: "builder-2",
      signedAt: serverTimestamp(),
    }));
    await assertFails(setDoc(doc(builderDb(), "riskAssessmentSignatures/risk-rules-2_builder-1"), {
      riskAssessmentId: "risk-rules-2",
      userId: "builder-1",
      signedAt: "2026-08-28",
    }));
    await assertFails(updateDoc(doc(managerDb(), "riskAssessmentSignatures/risk-rules-1_builder-1"), {
      userId: "manager-1",
    }));
  });

  test("protects inventory catalogs and isolates builder operations", async () => {
    const material = doc(managerDb(), "storageMaterials/material-1");
    const tool = doc(managerDb(), "storageTools/tool-1");
    await assertSucceeds(setDoc(material, {
      name: "Concrete",
      quantity: 10,
      unit: "bags",
      createdBy: "manager-1",
    }));
    await assertSucceeds(setDoc(tool, { name: "Drill", status: "available", createdBy: "manager-1" }));
    await seedProject("inventory-project-1", "builder-1", "Builder site");

    await assertSucceeds(getDoc(doc(builderDb(), material.path)));
    await assertSucceeds(getDoc(doc(builderDb(), tool.path)));
    await assertFails(updateDoc(doc(builderDb(), material.path), { quantity: 9 }));
    await assertFails(updateDoc(doc(builderDb(), tool.path), { status: "retired" }));

    const request = doc(builderDb(), "toolRequests/request-1");
    const pendingRequest = {
      toolId: "tool-1",
      projectId: "inventory-project-1",
      requestedBy: "builder-1",
      requestedByName: "Builder One",
      requestedAt: "now",
      status: "pending",
      notes: null,
      approvedBy: null,
      approvedAt: null,
      pickedUpBy: null,
      pickedUpAt: null,
      deliveredBy: null,
      deliveredAt: null,
      returnedBy: null,
      returnedAt: null,
      rejectionReason: null,
      checkoutId: null,
      createdAt: "now",
      updatedAt: "now",
    };
    await assertSucceeds(setDoc(request, pendingRequest));
    await assertFails(setDoc(doc(builderDb(), "toolRequests/forged-name"), {
      ...pendingRequest,
      requestedByName: "Manager One",
    }));
    await assertFails(setDoc(doc(builderDb(), "toolRequests/forged-approved"), {
      ...pendingRequest,
      status: "approved",
    }));
    await assertSucceeds(getDoc(request));
    await assertFails(getDoc(doc(otherBuilderDb(), request.path)));
    await assertFails(updateDoc(request, { status: "approved" }));
    await assertSucceeds(updateDoc(doc(managerDb(), request.path), { status: "approved" }));
    await assertFails(updateDoc(doc(managerDb(), request.path), { status: "delivered" }));
    await assertSucceeds(updateDoc(doc(managerDb(), request.path), {
      status: "picked_up",
      checkoutId: "checkout-1",
    }));

    const checkout = doc(builderDb(), "toolCheckouts/checkout-1");
    const checkoutData = {
      toolId: "tool-1",
      projectId: "inventory-project-1",
      checkedOutBy: "builder-1",
      issuedBy: "manager-1",
      returnedAt: null,
    };
    await assertFails(setDoc(checkout, checkoutData));
    await assertSucceeds(setDoc(doc(managerDb(), checkout.path), checkoutData));
    await assertSucceeds(getDoc(checkout));
    await assertFails(getDoc(doc(otherBuilderDb(), checkout.path)));
    await assertFails(updateDoc(checkout, { returnedAt: "now", returnedBy: "builder-1" }));
    await assertSucceeds(updateDoc(doc(managerDb(), checkout.path), {
      returnedAt: "now",
      returnedBy: "manager-1",
    }));

    const transfer = doc(builderDb(), "materialTransfers/transfer-1");
    await assertFails(setDoc(transfer, {
      materialId: "material-1",
      materialName: "Concrete",
      materialUnit: "bags",
      projectId: "inventory-project-1",
      projectName: "Builder site",
      quantity: 2,
      transferredBy: "builder-1",
      transferredByName: "Builder One",
      transferredAt: serverTimestamp(),
      notes: null,
    }));
    const transferManagerDb = managerDb();
    const managerTransfer = doc(transferManagerDb, transfer.path);
    const transferData = {
      materialId: "material-1",
      materialName: "Concrete",
      materialUnit: "bags",
      projectId: "inventory-project-1",
      projectName: "Builder site",
      quantity: 2,
      transferredBy: "manager-1",
      transferredByName: "Manager One",
      transferredAt: serverTimestamp(),
      notes: "Issued to site",
    };
    await assertFails(setDoc(managerTransfer, transferData));
    const forgedTransferBatch = writeBatch(transferManagerDb);
    forgedTransferBatch.update(doc(transferManagerDb, material.path), { quantity: 8, updatedAt: serverTimestamp() });
    forgedTransferBatch.set(doc(transferManagerDb, "materialTransfers/forged-transfer-name"), {
      ...transferData,
      transferredByName: "Builder One",
    });
    await assertFails(forgedTransferBatch.commit());
    const transferBatch = writeBatch(transferManagerDb);
    transferBatch.update(doc(transferManagerDb, material.path), { quantity: 8, updatedAt: serverTimestamp() });
    transferBatch.set(managerTransfer, transferData);
    await assertSucceeds(transferBatch.commit());
    await assertFails(getDoc(doc(builderDb(), transfer.path)));
    await assertFails(updateDoc(managerTransfer, { quantity: 1 }));
    await assertFails(deleteDoc(managerTransfer));
  });

  test("protects material usage, deliveries and rubbish requests", async () => {
    const usageMaterial = doc(managerDb(), "storageMaterials/usage-material-1");
    await seedProject("usage-project-1", "builder-1", "Usage project");
    await assertSucceeds(setDoc(usageMaterial, {
      name: "Usage material",
      quantity: 10,
      unit: "units",
      createdBy: "manager-1",
    }));
    const usageManagerDb = managerDb();
    const usage = doc(usageManagerDb, "materialUsage/usage-1");
    const usageData = {
      projectId: "usage-project-1",
      projectName: "Usage project",
      materialId: "usage-material-1",
      materialName: "Usage material",
      materialUnit: "units",
      jobId: null,
      quantityUsed: 2,
      usedBy: "manager-1",
      usedByName: "Manager One",
      date: "2026-08-24",
      notes: "Direct site use",
      createdAt: serverTimestamp(),
    };
    await assertFails(setDoc(usage, usageData));
    await assertFails(setDoc(doc(builderDb(), "materialUsage/builder-direct-usage"), {
      ...usageData,
      usedBy: "builder-1",
      usedByName: "Builder One",
    }));
    const forgedUsageBatch = writeBatch(usageManagerDb);
    forgedUsageBatch.update(doc(usageManagerDb, usageMaterial.path), { quantity: 8, updatedAt: serverTimestamp() });
    forgedUsageBatch.set(doc(usageManagerDb, "materialUsage/forged-usage-name"), {
      ...usageData,
      usedByName: "Builder One",
    });
    await assertFails(forgedUsageBatch.commit());
    const usageBatch = writeBatch(usageManagerDb);
    usageBatch.update(doc(usageManagerDb, usageMaterial.path), { quantity: 8, updatedAt: serverTimestamp() });
    usageBatch.set(usage, usageData);
    await assertSucceeds(usageBatch.commit());
    await assertSucceeds(getDoc(usage));
    await assertFails(getDoc(doc(builderDb(), usage.path)));
    await assertFails(updateDoc(usage, { quantityUsed: 1 }));
    await assertFails(deleteDoc(usage));

    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), "materialUsage/builder-owned-usage"), {
        usedBy: "builder-1",
        projectId: "usage-project-1",
      });
    });
    await assertSucceeds(getDoc(doc(builderDb(), "materialUsage/builder-owned-usage")));
    await assertFails(getDoc(doc(otherBuilderDb(), "materialUsage/builder-owned-usage")));

    await seedProject("delivery-project-1", "builder-1", "Delivery project");
    await assertSucceeds(setDoc(doc(managerDb(), "storageMaterials/delivery-material-1"), {
      name: "Cement",
      quantity: 10,
      createdBy: "manager-1",
    }));

    const deliveryDb = builderDb();
    const delivery = doc(deliveryDb, "materialDeliveryRequests/delivery-1");
    const deliveryItem = doc(deliveryDb, "materialDeliveryItems/delivery-item-1");
    const deliveryBatch = writeBatch(deliveryDb);
    const deliveryData = {
      userId: "builder-1",
      requestedByName: "Builder One",
      projectId: "delivery-project-1",
      status: "pending",
      notes: null,
      createdAt: serverTimestamp(),
      resolvedAt: null,
      resolvedBy: null,
    };
    await assertFails(setDoc(doc(builderDb(), "materialDeliveryRequests/forged-name"), {
      ...deliveryData,
      requestedByName: "Manager One",
    }));
    deliveryBatch.set(delivery, deliveryData);
    deliveryBatch.set(deliveryItem, {
      requestId: delivery.id,
      materialId: "delivery-material-1",
      quantity: 3,
      createdAt: serverTimestamp(),
    });
    await assertSucceeds(deliveryBatch.commit());
    await assertFails(getDoc(doc(otherBuilderDb(), delivery.path)));
    await assertFails(getDoc(doc(otherBuilderDb(), deliveryItem.path)));
    await assertFails(setDoc(doc(builderDb(), "materialDeliveryItems/late-item"), {
      requestId: delivery.id,
      materialId: "delivery-material-1",
      quantity: 1,
      createdAt: serverTimestamp(),
    }));
    await assertFails(updateDoc(doc(managerDb(), delivery.path), { status: "delivered" }));
    await assertFails(updateDoc(doc(managerDb(), delivery.path), { projectId: "another-project" }));
    await assertSucceeds(updateDoc(doc(managerDb(), delivery.path), {
      status: "in_progress",
      resolvedAt: null,
      resolvedBy: null,
    }));
    await assertSucceeds(updateDoc(doc(managerDb(), delivery.path), {
      status: "delivered",
      resolvedAt: serverTimestamp(),
      resolvedBy: "manager-1",
    }));

    const rubbish = doc(builderDb(), "rubbishCollectionRequests/rubbish-1");
    const rubbishData = {
      userId: "builder-1",
      requestedByName: "Builder One",
      projectId: "delivery-project-1",
      status: "pending",
      photoPaths: ["rubbish/builder-1/rubbish-1/photo.jpg"],
      description: "Waste bags",
      createdAt: serverTimestamp(),
      resolvedAt: null,
      resolvedBy: null,
    };
    await assertSucceeds(setDoc(rubbish, rubbishData));
    await assertFails(setDoc(doc(builderDb(), "rubbishCollectionRequests/forged-rubbish"), {
      ...rubbishData,
      requestedByName: "Manager One",
      photoPaths: ["rubbish/builder-1/forged-rubbish/photo.jpg"],
    }));
    await assertFails(setDoc(doc(builderDb(), "rubbishCollectionRequests/wrong-photo-owner"), {
      ...rubbishData,
      photoPaths: ["rubbish/builder-2/wrong-photo-owner/photo.jpg"],
    }));
    await assertFails(getDoc(doc(otherBuilderDb(), rubbish.path)));
    await assertFails(updateDoc(rubbish, { status: "resolved" }));
    await assertSucceeds(updateDoc(doc(managerDb(), rubbish.path), {
      status: "resolved",
      resolvedAt: serverTimestamp(),
      resolvedBy: "manager-1",
    }));
    await assertFails(deleteDoc(doc(managerDb(), rubbish.path)));
  });
});
