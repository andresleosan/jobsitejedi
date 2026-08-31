import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { provisionEmulatorUser } from "../../scripts/lib/firebase-auth-emulator.mjs";

const builderCredentials = {
  email: `repository-builder-${Date.now()}@example.test`,
  password: "Valid-password-123!",
  fullName: "Repository Builder",
};

const managerCredentials = {
  email: `repository-manager-${Date.now()}@example.test`,
  password: "Valid-password-123!",
  fullName: "Repository Manager",
};

let createProject: typeof import("@/lib/firebase/repositories/projects").createProject;
let getProject: typeof import("@/lib/firebase/repositories/projects").getProject;
let listProjects: typeof import("@/lib/firebase/repositories/projects").listProjects;
let updateProject: typeof import("@/lib/firebase/repositories/projects").updateProject;
let signIn: typeof import("@/lib/firebase/auth").signIn;
let signOut: typeof import("@/lib/firebase/auth").signOut;
let builderId = "";

describe("Firebase project repository", () => {
  beforeAll(async () => {
    vi.stubEnv("VITE_FIREBASE_USE_EMULATORS", "true");
    ({ signIn, signOut } = await import("@/lib/firebase/auth"));
    ({ createProject, getProject, listProjects, updateProject } =
      await import("@/lib/firebase/repositories/projects"));
    const builder = await provisionEmulatorUser({
      email: builderCredentials.email,
      password: builderCredentials.password,
      displayName: builderCredentials.fullName,
      role: "builder",
    });
    builderId = builder.uid;
    await provisionEmulatorUser({
      email: managerCredentials.email,
      password: managerCredentials.password,
      displayName: managerCredentials.fullName,
      role: "manager",
    });
    await signIn(managerCredentials.email, managerCredentials.password);
  });

  afterAll(async () => {
    await signOut();
    vi.unstubAllEnvs();
  });

  test("creates, lists, reads and updates an owned project", async () => {
    const created = await createProject({
      builderId,
      name: "Repository project",
      clientName: "BuildTrack Client",
      description: "Created through the Firebase repository",
      address: "1 Test Street",
    });

    expect(created.builderId).toBe(builderId);
    expect(created.ownerId).toBe(builderId);
    expect(created.name).toBe("Repository project");
    expect(created.status).toBe("active");

    const listed = await listProjects("active");
    expect(listed.some((project) => project.id === created.id)).toBe(true);

    const fetched = await getProject(created.id);
    expect(fetched?.clientName).toBe("BuildTrack Client");

    const updated = await updateProject(created.id, {
      name: "Updated repository project",
      clientName: "Updated client",
      status: "finished",
    });
    expect(updated.name).toBe("Updated repository project");
    expect(updated.status).toBe("finished");

    await signOut();
    await signIn(builderCredentials.email, builderCredentials.password);
    expect((await listProjects()).map((project) => project.id)).toContain(created.id);
    await expect(updateProject(created.id, {
      name: "Unauthorized builder edit",
      clientName: "Updated client",
    })).rejects.toThrow("Manager access is required");
  });
});
