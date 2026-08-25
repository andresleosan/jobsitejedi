import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";

const credentials = {
  email: `jobs-repository-${Date.now()}@example.test`,
  password: "Valid-password-123!",
  fullName: "Jobs Repository Builder",
};

let createJob: typeof import("@/lib/firebase/repositories/jobs").createJob;
let listJobsForProject: typeof import("@/lib/firebase/repositories/jobs").listJobsForProject;
let listJobSections: typeof import("@/lib/firebase/repositories/jobs").listJobSections;
let createProject: typeof import("@/lib/firebase/repositories/projects").createProject;
let registerBuilder: typeof import("@/lib/firebase/auth").registerBuilder;
let signIn: typeof import("@/lib/firebase/auth").signIn;
let signOut: typeof import("@/lib/firebase/auth").signOut;
let adminAuth: ReturnType<typeof import("../../functions/node_modules/firebase-admin/lib/auth/index.js").getAuth>;

describe("Firebase jobs repository", () => {
  beforeAll(async () => {
    vi.stubEnv("VITE_FIREBASE_USE_EMULATORS", "true");
    const [{ getApps, initializeApp }, { getAuth }] = await Promise.all([
      import("../../functions/node_modules/firebase-admin/lib/app/index.js"),
      import("../../functions/node_modules/firebase-admin/lib/auth/index.js"),
    ]);
    const adminApp = getApps().find((app) => app.name === "firebase-jobs-tests")
      ?? initializeApp({ projectId: "demo-jobsite-jedi" }, "firebase-jobs-tests");
    adminAuth = getAuth(adminApp);
    ({ registerBuilder, signIn, signOut } = await import("@/lib/firebase/auth"));
    ({ createJob, listJobsForProject, listJobSections } = await import("@/lib/firebase/repositories/jobs"));
    ({ createProject } = await import("@/lib/firebase/repositories/projects"));
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

  test("assigns manager-created jobs to the project's builder owner", async () => {
    const project = await createProject({
      name: "Manager assignment project",
      clientName: "Assignment client",
    });
    const builderId = project.ownerId;

    await signOut();
    const managerCredentials = {
      email: `jobs-manager-${Date.now()}@example.test`,
      password: "Valid-password-123!",
      fullName: "Jobs Repository Manager",
    };
    const manager = await registerBuilder(managerCredentials);
    await adminAuth.setCustomUserClaims(manager.id, { role: "manager" });
    await signOut();
    await signIn(managerCredentials.email, managerCredentials.password);

    const created = await createJob({
      projectId: project.id,
      title: "Manager assigned work",
      section: "Structure",
    });

    expect(created.builderId).toBe(builderId);
  }, 15_000);
});
