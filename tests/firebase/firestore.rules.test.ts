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
import { doc, getDoc, setDoc, updateDoc } from "firebase/firestore";
import { readFileSync } from "node:fs";

const projectId = "demo-jobsite-jedi";
let testEnv: RulesTestEnvironment;

const builderDb = () =>
  testEnv.authenticatedContext("builder-1", { role: "builder" }).firestore();
const otherBuilderDb = () =>
  testEnv.authenticatedContext("builder-2", { role: "builder" }).firestore();
const managerDb = () =>
  testEnv.authenticatedContext("manager-1", { role: "manager" }).firestore();
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
    await assertSucceeds(setDoc(material, { name: "Concrete", quantity: 10, createdBy: "manager-1" }));
    await assertSucceeds(setDoc(tool, { name: "Drill", status: "available", createdBy: "manager-1" }));

    await assertSucceeds(getDoc(doc(builderDb(), material.path)));
    await assertSucceeds(getDoc(doc(builderDb(), tool.path)));
    await assertFails(updateDoc(doc(builderDb(), material.path), { quantity: 9 }));
    await assertFails(updateDoc(doc(builderDb(), tool.path), { status: "retired" }));

    const request = doc(builderDb(), "toolRequests/request-1");
    await assertSucceeds(setDoc(request, {
      toolId: "tool-1",
      projectId: "project-1",
      requestedBy: "builder-1",
      status: "pending",
    }));
    await assertSucceeds(getDoc(request));
    await assertFails(getDoc(doc(otherBuilderDb(), request.path)));
    await assertFails(updateDoc(request, { status: "approved" }));
    await assertSucceeds(updateDoc(doc(managerDb(), request.path), { status: "approved" }));

    const checkout = doc(builderDb(), "toolCheckouts/checkout-1");
    await assertSucceeds(setDoc(checkout, {
      toolId: "tool-1",
      projectId: "project-1",
      checkedOutBy: "builder-1",
      returnedAt: null,
    }));
    await assertFails(getDoc(doc(otherBuilderDb(), checkout.path)));
    await assertSucceeds(updateDoc(checkout, { returnedAt: "now", returnedBy: "builder-1" }));
    await assertFails(updateDoc(checkout, { toolId: "tool-2" }));

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
});
