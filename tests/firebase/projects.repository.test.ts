import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";

const credentials = {
  email: `repository-${Date.now()}@example.test`,
  password: "Valid-password-123!",
  fullName: "Repository Builder",
};

let createProject: typeof import("@/lib/firebase/repositories/projects").createProject;
let getProject: typeof import("@/lib/firebase/repositories/projects").getProject;
let listProjects: typeof import("@/lib/firebase/repositories/projects").listProjects;
let updateProject: typeof import("@/lib/firebase/repositories/projects").updateProject;
let registerBuilder: typeof import("@/lib/firebase/auth").registerBuilder;
let signOut: typeof import("@/lib/firebase/auth").signOut;

describe("Firebase project repository", () => {
  beforeAll(async () => {
    vi.stubEnv("VITE_FIREBASE_USE_EMULATORS", "true");
    ({ registerBuilder, signOut } = await import("@/lib/firebase/auth"));
    ({ createProject, getProject, listProjects, updateProject } =
      await import("@/lib/firebase/repositories/projects"));
    await registerBuilder(credentials);
  });

  afterAll(async () => {
    await signOut();
    vi.unstubAllEnvs();
  });

  test("creates, lists, reads and updates an owned project", async () => {
    const created = await createProject({
      name: "Repository project",
      clientName: "BuildTrack Client",
      description: "Created through the Firebase repository",
      address: "1 Test Street",
    });

    expect(created.ownerId).toBeTruthy();
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
  });
});
