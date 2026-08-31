import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { provisionEmulatorUser } from "../helpers/firebase-auth-emulator";

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const password = "AssignmentTest9!";

interface ProvisionedUser {
  id: string;
  email: string;
  password: string;
  displayName: string;
}

let provisionUser: (
  label: string,
  role: "manager" | "builder",
  disabled?: boolean,
) => Promise<ProvisionedUser>;
let signIn: typeof import("@/lib/firebase/auth").signIn;
let signOut: typeof import("@/lib/firebase/auth").signOut;
let listAssignableBuilders: typeof import("@/lib/firebase/functions").listAssignableBuilders;
let createProject: typeof import("@/lib/firebase/repositories/projects").createProject;
let getProject: typeof import("@/lib/firebase/repositories/projects").getProject;
let listProjects: typeof import("@/lib/firebase/repositories/projects").listProjects;
let updateProject: typeof import("@/lib/firebase/repositories/projects").updateProject;
let createJob: typeof import("@/lib/firebase/repositories/jobs").createJob;
let listJobsForProject: typeof import("@/lib/firebase/repositories/jobs").listJobsForProject;

describe("manager project assignment flow", () => {
  beforeAll(async () => {
    vi.stubEnv("VITE_FIREBASE_USE_EMULATORS", "true");
    provisionUser = async (label, role, disabled = false) => {
      const displayName = `Assignment ${label}`;
      const email = `assignment-${label}-${suffix}@example.test`;
      const user = await provisionEmulatorUser({ email, password, displayName, role, disabled });
      return { id: user.uid, email, password, displayName };
    };

    ({ signIn, signOut } = await import("@/lib/firebase/auth"));
    ({ listAssignableBuilders } = await import("@/lib/firebase/functions"));
    ({ createProject, getProject, listProjects, updateProject } =
      await import("@/lib/firebase/repositories/projects"));
    ({ createJob, listJobsForProject } = await import("@/lib/firebase/repositories/jobs"));
  });

  afterAll(async () => {
    await signOut();
    vi.unstubAllEnvs();
  });

  test("assigns an authorized builder and keeps projects and jobs isolated", async () => {
    const [manager, assignedBuilder, otherBuilder, disabledBuilder] = await Promise.all([
      provisionUser("manager", "manager"),
      provisionUser("builder-one", "builder"),
      provisionUser("builder-two", "builder"),
      provisionUser("builder-disabled", "builder", true),
    ]);

    await signIn(manager.email, manager.password);
    const assignableBuilders = await listAssignableBuilders();
    expect(assignableBuilders.map((builder) => builder.id)).toEqual(
      expect.arrayContaining([assignedBuilder.id, otherBuilder.id]),
    );
    expect(assignableBuilders.map((builder) => builder.id)).not.toContain(manager.id);
    expect(assignableBuilders.map((builder) => builder.id)).not.toContain(disabledBuilder.id);

    await expect(createProject({
      builderId: manager.id,
      name: "Invalid manager assignment",
      clientName: "Invalid client",
    })).rejects.toMatchObject({ code: "functions/failed-precondition" });

    const project = await createProject({
      builderId: assignedBuilder.id,
      name: "Assigned construction project",
      clientName: "Assignment client",
      description: "Created by a manager for one provisioned builder",
    });
    expect(project).toMatchObject({
      builderId: assignedBuilder.id,
      ownerId: assignedBuilder.id,
      createdBy: manager.id,
      status: "active",
    });

    await expect(createJob({
      projectId: project.id,
      builderId: otherBuilder.id,
      title: "Cross-assigned work",
    })).rejects.toThrow("must match the builder assigned to the project");
    await expect(createJob({
      projectId: project.id,
      title: "Invalid initial lifecycle",
      status: "pending",
    })).rejects.toThrow("must start in approved status");

    const job = await createJob({
      projectId: project.id,
      title: "Install assigned framing",
      section: "Structure",
    });
    expect(job.builderId).toBe(assignedBuilder.id);

    await signOut();
    await signIn(assignedBuilder.email, assignedBuilder.password);
    await expect(listProjects("active")).resolves.toEqual([
      expect.objectContaining({ id: project.id, builderId: assignedBuilder.id }),
    ]);
    await expect(listJobsForProject(project.id, [])).resolves.toEqual([
      expect.objectContaining({ id: job.id, builderId: assignedBuilder.id }),
    ]);
    await expect(updateProject(project.id, {
      name: "Builder edit attempt",
      clientName: "Assignment client",
    })).rejects.toThrow("Manager access is required");
    await expect(createJob({ projectId: project.id, title: "Builder-created job" }))
      .rejects.toThrow("Manager access is required");

    await signOut();
    await signIn(otherBuilder.email, otherBuilder.password);
    await expect(listProjects("active")).resolves.toEqual([]);
    await expect(listJobsForProject(project.id, [])).rejects.toBeDefined();
    await expect(getProject(project.id)).rejects.toBeDefined();
  }, 30_000);
});
