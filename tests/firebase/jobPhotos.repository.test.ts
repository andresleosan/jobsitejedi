import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { provisionEmulatorUser } from "../../scripts/lib/firebase-auth-emulator.mjs";

const credentials = {
  email: `job-photos-${Date.now()}@example.test`,
  password: "Valid-password-123!",
  fullName: "Job Photos Builder",
};

const managerCredentials = {
  email: `job-photos-manager-${Date.now()}@example.test`,
  password: "Valid-password-123!",
  fullName: "Job Photos Manager",
};

let createJob: typeof import("@/lib/firebase/repositories/jobs").createJob;
let uploadJobPhoto: typeof import("@/lib/firebase/repositories/jobPhotos").uploadJobPhoto;
let listJobPhotos: typeof import("@/lib/firebase/repositories/jobPhotos").listJobPhotos;
let deleteJobPhoto: typeof import("@/lib/firebase/repositories/jobPhotos").deleteJobPhoto;
let submitJobForReview: typeof import("@/lib/firebase/repositories/jobs").submitJobForReview;
let createProject: typeof import("@/lib/firebase/repositories/projects").createProject;
let signIn: typeof import("@/lib/firebase/auth").signIn;
let signOut: typeof import("@/lib/firebase/auth").signOut;
let photoJobId = "";
let invalidPhotoJobId = "";

describe("Firebase job photos repository", () => {
  beforeAll(async () => {
    vi.stubEnv("VITE_FIREBASE_USE_EMULATORS", "true");
    ({ signIn, signOut } = await import("@/lib/firebase/auth"));
    ({ createJob, submitJobForReview } = await import("@/lib/firebase/repositories/jobs"));
    ({ createProject } = await import("@/lib/firebase/repositories/projects"));
    ({ uploadJobPhoto, listJobPhotos, deleteJobPhoto } =
      await import("@/lib/firebase/repositories/jobPhotos"));
    const builder = await provisionEmulatorUser({
      email: credentials.email,
      password: credentials.password,
      displayName: credentials.fullName,
      role: "builder",
    });
    await provisionEmulatorUser({
      email: managerCredentials.email,
      password: managerCredentials.password,
      displayName: managerCredentials.fullName,
      role: "manager",
    });
    await signIn(managerCredentials.email, managerCredentials.password);
    const project = await createProject({
      builderId: builder.uid,
      name: "Job photos project",
      clientName: "Job photos client",
    });
    photoJobId = (await createJob({ projectId: project.id, title: "Photo job" })).id;
    invalidPhotoJobId = (await createJob({ projectId: project.id, title: "Invalid photo job" })).id;
    await signOut();
    await signIn(credentials.email, credentials.password);
  });

  afterAll(async () => {
    await signOut();
    vi.unstubAllEnvs();
  });

  test("allows draft cleanup and locks photo evidence after review submission", async () => {
    const photo = await uploadJobPhoto({
      jobId: photoJobId,
      kind: "reference",
      fileName: "reference photo.jpg",
      contentType: "image/jpeg",
      file: new Blob(["original"] , { type: "image/jpeg" }),
      thumbnail: new Blob(["thumbnail"], { type: "image/jpeg" }),
    });

    expect(photo.originalPath).toContain(`/reference/${photo.id}-reference_photo.jpg`);
    expect(photo.thumbnailPath).toContain("/thumbnails/");
    expect((await listJobPhotos(photoJobId, "reference"))).toHaveLength(1);

    await deleteJobPhoto(photo.id);
    expect(await listJobPhotos(photoJobId, "reference")).toHaveLength(0);

    const lockedPhoto = await uploadJobPhoto({
      jobId: photoJobId,
      kind: "reference",
      fileName: "locked reference.jpg",
      contentType: "image/jpeg",
      file: new Blob(["locked-original"], { type: "image/jpeg" }),
      thumbnail: new Blob(["locked-thumbnail"], { type: "image/jpeg" }),
    });

    const submitted = await submitJobForReview(photoJobId);
    expect(submitted.status).toBe("waiting_review");

    await expect(deleteJobPhoto(lockedPhoto.id)).rejects.toThrow();
    expect(await listJobPhotos(photoJobId, "reference")).toHaveLength(1);
  });

  test("rejects non-image files before writing storage", async () => {
    await expect(
      uploadJobPhoto({
        jobId: invalidPhotoJobId,
        kind: "completion",
        fileName: "notes.txt",
        contentType: "text/plain",
        file: new Blob(["text"], { type: "text/plain" }),
        thumbnail: new Blob(["text"], { type: "text/plain" }),
      }),
    ).rejects.toThrow("Only image files are supported");
  });
});
