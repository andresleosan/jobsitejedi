import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { provisionEmulatorUser } from "../../scripts/lib/firebase-auth-emulator.mjs";

const suffix = Date.now();
const password = "Valid-password-123!";
const builderCredentials = {
  email: `jobs-repository-builder-${suffix}@example.test`,
  password,
  displayName: "Jobs Repository Builder",
};
const otherBuilderCredentials = {
  email: `jobs-repository-other-${suffix}@example.test`,
  password,
  displayName: "Jobs Repository Other Builder",
};
const managerCredentials = {
  email: `jobs-repository-manager-${suffix}@example.test`,
  password,
  displayName: "Jobs Repository Manager",
};

let createJob: typeof import("@/lib/firebase/repositories/jobs").createJob;
let listJobsForProject: typeof import("@/lib/firebase/repositories/jobs").listJobsForProject;
let listJobSections: typeof import("@/lib/firebase/repositories/jobs").listJobSections;
let createProject: typeof import("@/lib/firebase/repositories/projects").createProject;
let signIn: typeof import("@/lib/firebase/auth").signIn;
let signOut: typeof import("@/lib/firebase/auth").signOut;
let builderId = "";
let otherBuilderId = "";
let projectId = "";

describe("Firebase jobs repository", () => {
  beforeAll(async () => {
    vi.stubEnv("VITE_FIREBASE_USE_EMULATORS", "true");
    const [builder, otherBuilder] = await Promise.all([
      provisionEmulatorUser({ ...builderCredentials, role: "builder" }),
      provisionEmulatorUser({ ...otherBuilderCredentials, role: "builder" }),
      provisionEmulatorUser({ ...managerCredentials, role: "manager" }),
    ]);
    builderId = builder.uid;
    otherBuilderId = otherBuilder.uid;

    ({ signIn, signOut } = await import("@/lib/firebase/auth"));
    ({ createJob, listJobsForProject, listJobSections } =
      await import("@/lib/firebase/repositories/jobs"));
    ({ createProject } = await import("@/lib/firebase/repositories/projects"));

    await signIn(managerCredentials.email, managerCredentials.password);
    const project = await createProject({
      builderId,
      name: "Manager assignment project",
      clientName: "Assignment client",
    });
    projectId = project.id;
  });

  afterAll(async () => {
    await signOut();
    vi.unstubAllEnvs();
  });

  test("manager-created jobs inherit the project's assigned builder", async () => {
    await signOut();
    await signIn(managerCredentials.email, managerCredentials.password);
    const first = await createJob({
      projectId,
      title: "Install framing",
      description: "Frame the north wall",
      section: "Structure",
    });
    await createJob({
      projectId,
      title: "Prepare flooring",
      section: "Finishes",
    });

    expect(first.builderId).toBe(builderId);
    await expect(createJob({
      projectId,
      title: "Invalid initial lifecycle",
      status: "waiting_review",
    })).rejects.toThrow("must start in approved status");
    expect(await listJobSections(projectId)).toEqual(["Finishes", "Structure"]);

    await signOut();
    await signIn(builderCredentials.email, builderCredentials.password);
    const jobs = await listJobsForProject(projectId);
    expect(jobs).toHaveLength(2);
    expect(jobs.every((job) => job.builderId === builderId)).toBe(true);
  });

  test("rejects cross-assignment and hides the jobs from another builder", async () => {
    await signOut();
    await signIn(managerCredentials.email, managerCredentials.password);
    await expect(createJob({
      projectId,
      builderId: otherBuilderId,
      title: "Cross-assigned work",
    })).rejects.toThrow("must match the builder assigned to the project");

    await signOut();
    await signIn(otherBuilderCredentials.email, otherBuilderCredentials.password);
    await expect(listJobsForProject(projectId, [])).rejects.toBeDefined();
    await expect(createJob({ projectId, title: "Builder-created work" }))
      .rejects.toThrow("Manager access is required");
  });
});
