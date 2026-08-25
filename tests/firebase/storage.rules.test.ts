import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { doc, serverTimestamp, setDoc } from "firebase/firestore";
import { deleteObject, getBytes, ref, uploadBytes } from "firebase/storage";
import { readFileSync } from "node:fs";

const projectId = "demo-jobsite-jedi";
let testEnv: RulesTestEnvironment;

const builderStorage = () =>
  testEnv.authenticatedContext("builder-1", { role: "builder", name: "Builder One" }).storage();
const otherBuilderStorage = () =>
  testEnv.authenticatedContext("builder-2", { role: "builder", name: "Builder Two" }).storage();
const managerStorage = () =>
  testEnv.authenticatedContext("manager-1", { role: "manager", name: "Manager One" }).storage();
const builderDb = () =>
  testEnv.authenticatedContext("builder-1", { role: "builder", name: "Builder One" }).firestore();
const managerDb = () =>
  testEnv.authenticatedContext("manager-1", { role: "manager", name: "Manager One" }).firestore();
const anonymousStorage = () => testEnv.unauthenticatedContext().storage();

const image = () => new Blob(["image-content"], { type: "image/jpeg" });

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
  });

  afterAll(async () => {
    await testEnv.cleanup();
  });

  test("allows an owner to upload and download a job image", async () => {
    const path = "jobs/job-1/builder-1/reference/photo.jpg";
    await assertSucceeds(uploadBytes(ref(builderStorage(), path), await image()));
    const bytes = await assertSucceeds(getBytes(ref(builderStorage(), path)));
    expect(new TextDecoder().decode(bytes)).toBe("image-content");
  });

  test("blocks anonymous and cross-builder access", async () => {
    const path = "jobs/job-2/builder-1/reference/photo.jpg";
    await assertFails(uploadBytes(ref(anonymousStorage(), path), await image()));
    await assertFails(getBytes(ref(otherBuilderStorage(), path)));
  });

  test("allows managers to review and write job files", async () => {
    const path = "jobs/job-3/builder-1/feedback/photo.jpg";
    await assertSucceeds(uploadBytes(ref(managerStorage(), path), await image()));
    await assertSucceeds(getBytes(ref(managerStorage(), path)));
  });

  test("supports the remaining private domain roots for the owner", async () => {
    for (const root of ["dailyReports", "documents", "materials", "voiceNotes"]) {
      await assertSucceeds(
        uploadBytes(ref(builderStorage(), `${root}/builder-1/file.bin`), await image()),
      );
    }
  });

  test("locks private invoice evidence after the server record exists", async () => {
    const path = "invoices/builder-1/invoice-storage-1/invoice.pdf";
    const pdf = new Blob(["invoice-pdf"], { type: "application/pdf" });
    await assertSucceeds(uploadBytes(ref(builderStorage(), path), pdf));
    await assertSucceeds(getBytes(ref(builderStorage(), path)));
    await assertSucceeds(getBytes(ref(managerStorage(), path)));
    await assertFails(getBytes(ref(otherBuilderStorage(), path)));
    await assertFails(uploadBytes(
      ref(managerStorage(), "invoices/builder-1/manager-write/invoice.pdf"),
      pdf,
    ));
    await assertFails(uploadBytes(ref(builderStorage(), path), pdf));

    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), "invoices/invoice-storage-1"), {
        uploadedBy: "builder-1",
        filePath: path,
        status: "submitted",
      });
    });
    await assertFails(deleteObject(ref(builderStorage(), path)));
    await assertFails(uploadBytes(ref(builderStorage(), path), pdf));
  });

  test("keeps rubbish evidence immutable after its request is created", async () => {
    const orphanPath = "rubbish/builder-1/orphan-request/photo.jpg";
    await assertSucceeds(uploadBytes(ref(builderStorage(), orphanPath), await image()));
    await assertSucceeds(deleteObject(ref(builderStorage(), orphanPath)));

    const path = "rubbish/builder-1/request-locked/photo.jpg";
    await assertSucceeds(uploadBytes(ref(builderStorage(), path), await image()));
    await assertSucceeds(setDoc(doc(managerDb(), "projects/rubbish-project"), {
      ownerId: "builder-1",
      name: "Rubbish project",
    }));
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
