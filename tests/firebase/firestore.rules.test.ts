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

  test("protects inventory catalogs and isolates builder operations", async () => {
    const material = doc(managerDb(), "storageMaterials/material-1");
    const tool = doc(managerDb(), "storageTools/tool-1");
    const project = doc(managerDb(), "projects/inventory-project-1");
    await assertSucceeds(setDoc(material, { name: "Concrete", quantity: 10, createdBy: "manager-1" }));
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
      projectId: "project-1",
      quantity: 2,
      transferredBy: "builder-1",
    }));
    await assertSucceeds(setDoc(doc(managerDb(), transfer.path), {
      materialId: "material-1",
      projectId: "project-1",
      quantity: 2,
      transferredBy: "manager-1",
    }));
    await assertFails(getDoc(doc(builderDb(), transfer.path)));
  });

  test("protects material usage, deliveries and rubbish requests", async () => {
    const usage = doc(managerDb(), "materialUsage/usage-1");
    await assertSucceeds(setDoc(usage, { usedBy: "builder-1", projectId: "project-1", quantityUsed: 2 }));
    await assertSucceeds(getDoc(doc(builderDb(), usage.path)));
    await assertFails(getDoc(doc(otherBuilderDb(), usage.path)));
    await assertFails(updateDoc(doc(builderDb(), usage.path), { quantityUsed: 1 }));

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
