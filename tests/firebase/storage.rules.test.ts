import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { getBytes, ref, uploadBytes } from "firebase/storage";
import { readFileSync } from "node:fs";

const projectId = "demo-jobsite-jedi";
let testEnv: RulesTestEnvironment;

const builderStorage = () =>
  testEnv.authenticatedContext("builder-1", { role: "builder" }).storage();
const otherBuilderStorage = () =>
  testEnv.authenticatedContext("builder-2", { role: "builder" }).storage();
const managerStorage = () =>
  testEnv.authenticatedContext("manager-1", { role: "manager" }).storage();
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
    for (const root of ["dailyReports", "invoices", "documents", "materials", "rubbish", "voiceNotes"]) {
      await assertSucceeds(
        uploadBytes(ref(builderStorage(), `${root}/builder-1/file.bin`), await image()),
      );
    }
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
  });
});
