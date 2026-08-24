import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";

const credentials = {
  email: `jobs-repository-${Date.now()}@example.test`,
  password: "Valid-password-123!",
  fullName: "Jobs Repository Builder",
};

let createJob: typeof import("@/lib/firebase/repositories/jobs").createJob;
let listJobsForProject: typeof import("@/lib/firebase/repositories/jobs").listJobsForProject;
let listJobSections: typeof import("@/lib/firebase/repositories/jobs").listJobSections;
let registerBuilder: typeof import("@/lib/firebase/auth").registerBuilder;
let signOut: typeof import("@/lib/firebase/auth").signOut;

describe("Firebase jobs repository", () => {
  beforeAll(async () => {
    vi.stubEnv("VITE_FIREBASE_USE_EMULATORS", "true");
    ({ registerBuilder, signOut } = await import("@/lib/firebase/auth"));
    ({ createJob, listJobsForProject, listJobSections } = await import("@/lib/firebase/repositories/jobs"));
    await registerBuilder(credentials);
  });

  afterAll(async () => {
    await signOut();
    vi.unstubAllEnvs();
  });

  test("creates and lists jobs restricted to the authenticated builder", async () => {
    const first = await createJob({
      projectId: "project-jobs-repository",
      title: "Install framing",
      description: "Frame the north wall",
      section: "Structure",
    });
    await createJob({
      projectId: "project-jobs-repository",
      title: "Prepare flooring",
      section: "Finishes",
    });

    const jobs = await listJobsForProject("project-jobs-repository");
    expect(jobs).toHaveLength(2);
    expect(jobs.every((job) => job.builderId === first.builderId)).toBe(true);
    expect(await listJobSections("project-jobs-repository")).toEqual(["Finishes", "Structure"]);
  });
});
