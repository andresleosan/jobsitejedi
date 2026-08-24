import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";

const credentials = {
  email: `job-photos-${Date.now()}@example.test`,
  password: "Valid-password-123!",
  fullName: "Job Photos Builder",
};

let createJob: typeof import("@/lib/firebase/repositories/jobs").createJob;
let uploadJobPhoto: typeof import("@/lib/firebase/repositories/jobPhotos").uploadJobPhoto;
let listJobPhotos: typeof import("@/lib/firebase/repositories/jobPhotos").listJobPhotos;
let deleteJobPhoto: typeof import("@/lib/firebase/repositories/jobPhotos").deleteJobPhoto;
let submitJobForReview: typeof import("@/lib/firebase/repositories/jobs").submitJobForReview;
let registerBuilder: typeof import("@/lib/firebase/auth").registerBuilder;
let signOut: typeof import("@/lib/firebase/auth").signOut;

describe("Firebase job photos repository", () => {
  beforeAll(async () => {
    vi.stubEnv("VITE_FIREBASE_USE_EMULATORS", "true");
    ({ registerBuilder, signOut } = await import("@/lib/firebase/auth"));
    ({ createJob, submitJobForReview } = await import("@/lib/firebase/repositories/jobs"));
    ({ uploadJobPhoto, listJobPhotos, deleteJobPhoto } =
      await import("@/lib/firebase/repositories/jobPhotos"));
    await registerBuilder(credentials);
  });

  afterAll(async () => {
    await signOut();
    vi.unstubAllEnvs();
  });

  test("uploads original and thumbnail references for the owned job", async () => {
    const job = await createJob({ projectId: "photo-project", title: "Photo job" });
    const photo = await uploadJobPhoto({
      jobId: job.id,
      kind: "reference",
      fileName: "reference photo.jpg",
      contentType: "image/jpeg",
      file: new Blob(["original"] , { type: "image/jpeg" }),
      thumbnail: new Blob(["thumbnail"], { type: "image/jpeg" }),
    });

    expect(photo.originalPath).toContain(`/reference/${photo.id}-reference_photo.jpg`);
    expect(photo.thumbnailPath).toContain("/thumbnails/");
    expect((await listJobPhotos(job.id, "reference"))).toHaveLength(1);

    const submitted = await submitJobForReview(job.id);
    expect(submitted.status).toBe("waiting_review");

    await deleteJobPhoto(photo.id);
    expect(await listJobPhotos(job.id, "reference")).toHaveLength(0);
  });

  test("rejects non-image files before writing storage", async () => {
    const job = await createJob({ projectId: "photo-project", title: "Invalid photo job" });
    await expect(
      uploadJobPhoto({
        jobId: job.id,
        kind: "completion",
        fileName: "notes.txt",
        contentType: "text/plain",
        file: new Blob(["text"], { type: "text/plain" }),
        thumbnail: new Blob(["text"], { type: "text/plain" }),
      }),
    ).rejects.toThrow("Only image files are supported");
  });
});
