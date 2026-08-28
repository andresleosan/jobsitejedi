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
import { deleteDoc, doc, getDoc, serverTimestamp, setDoc, updateDoc, writeBatch } from "firebase/firestore";
import { readFileSync } from "node:fs";

const projectId = "demo-jobsite-jedi";
let testEnv: RulesTestEnvironment;

const builderDb = () =>
  testEnv.authenticatedContext("builder-1", { role: "builder", name: "Builder One" }).firestore();
const otherBuilderDb = () =>
  testEnv.authenticatedContext("builder-2", { role: "builder", name: "Builder Two" }).firestore();
const managerDb = () =>
  testEnv.authenticatedContext("manager-1", { role: "manager", name: "Manager One" }).firestore();
const anonymousDb = () => testEnv.unauthenticatedContext().firestore();

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
  });

  afterAll(async () => {
    await testEnv.cleanup();
  });

  test("blocks anonymous access and allows a builder to create their project", async () => {
    const project = doc(builderDb(), "projects/project-owned");
    const data = { ownerId: "builder-1", name: "Owned project" };

    await assertFails(setDoc(doc(anonymousDb(), project.path), data));
    await assertSucceeds(setDoc(project, data));
    await assertSucceeds(getDoc(project));
  });

  test("blocks a builder from reading or changing another builder's project", async () => {
    const project = doc(managerDb(), "projects/project-cross-user");
    await assertSucceeds(
      setDoc(project, { ownerId: "builder-1", name: "Protected project" }),
    );

    const otherProjectRef = doc(otherBuilderDb(), project.path);
    await assertFails(getDoc(otherProjectRef));
    await assertFails(updateDoc(otherProjectRef, { ownerId: "builder-2" }));
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

  test("applies builder ownership to jobs, completions and time entries", async () => {
    await assertSucceeds(
      setDoc(doc(builderDb(), "jobs/job-1"), { builderId: "builder-1" }),
    );
    await assertSucceeds(
      setDoc(doc(builderDb(), "jobCompletions/completion-1"), {
        builderId: "builder-1",
      }),
    );
    await assertSucceeds(
      setDoc(doc(builderDb(), "timeTracking/time-1"), {
        builderId: "builder-1",
      }),
    );

    await assertFails(getDoc(doc(otherBuilderDb(), "jobs/job-1")));
  });

  test("limits builder job updates to submitting for review", async () => {
    const job = doc(builderDb(), "jobs/review-transition");
    await assertSucceeds(
      setDoc(job, { builderId: "builder-1", status: "approved", title: "Review me" }),
    );
    await assertSucceeds(updateDoc(job, { status: "waiting_review", updatedAt: "now" }));
    await assertFails(updateDoc(job, { status: "completed", updatedAt: "later" }));
  });

  test("does not expose invitations to builders or permit direct writes", async () => {
    const invitation = doc(managerDb(), "invitations/invitation-1");
    await assertFails(
      setDoc(invitation, { role: "builder", status: "pending" }),
    );
    await assertFails(getDoc(doc(builderDb(), invitation.path)));
    await assertFails(getDoc(doc(anonymousDb(), invitation.path)));
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

  test("keeps daily reports and risk signatures scoped to the project owner", async () => {
    await assertSucceeds(setDoc(doc(builderDb(), "projects/report-rules-project"), {
      ownerId: "builder-1",
      name: "Report rules project",
    }));
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

    await assertSucceeds(setDoc(doc(builderDb(), "riskAssessmentSignatures/risk-signature-1"), {
      riskAssessmentId: "risk-rules-1",
      userId: "builder-1",
      signedAt: serverTimestamp(),
    }));
    await assertSucceeds(getDoc(doc(builderDb(), "riskAssessmentSignatures/risk-signature-1")));
    await assertFails(getDoc(doc(otherBuilderDb(), "riskAssessmentSignatures/risk-signature-1")));
    await assertFails(setDoc(doc(builderDb(), "riskAssessmentSignatures/forged-signature"), {
      riskAssessmentId: "risk-rules-1",
      userId: "builder-2",
      signedAt: serverTimestamp(),
    }));
    await assertFails(updateDoc(doc(managerDb(), "riskAssessmentSignatures/risk-signature-1"), {
      userId: "manager-1",
    }));
  });

  test("protects inventory catalogs and isolates builder operations", async () => {
    const material = doc(managerDb(), "storageMaterials/material-1");
    const tool = doc(managerDb(), "storageTools/tool-1");
    const project = doc(managerDb(), "projects/inventory-project-1");
    await assertSucceeds(setDoc(material, {
      name: "Concrete",
      quantity: 10,
      unit: "bags",
      createdBy: "manager-1",
    }));
    await assertSucceeds(setDoc(tool, { name: "Drill", status: "available", createdBy: "manager-1" }));
    await assertSucceeds(setDoc(project, { name: "Builder site", ownerId: "builder-1" }));

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
    const usageProject = doc(managerDb(), "projects/usage-project-1");
    const usageMaterial = doc(managerDb(), "storageMaterials/usage-material-1");
    await assertSucceeds(setDoc(usageProject, { ownerId: "builder-1", name: "Usage project" }));
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

    await assertSucceeds(setDoc(doc(managerDb(), "projects/delivery-project-1"), {
      ownerId: "builder-1",
      name: "Delivery project",
    }));
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
