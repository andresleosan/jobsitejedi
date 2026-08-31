import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { provisionEmulatorUser } from "../../scripts/lib/firebase-auth-emulator.mjs";

const credentials = {
  email: `time-repository-${Date.now()}@example.test`,
  password: "Valid-password-123!",
  displayName: "Time Repository Builder",
};

let getActiveTimeEntry: typeof import("@/lib/firebase/repositories/timeTracking").getActiveTimeEntry;
let startTimeEntry: typeof import("@/lib/firebase/repositories/timeTracking").startTimeEntry;
let stopTimeEntry: typeof import("@/lib/firebase/repositories/timeTracking").stopTimeEntry;
let switchTimeEntry: typeof import("@/lib/firebase/repositories/timeTracking").switchTimeEntry;
let startTravelTimeEntry: typeof import("@/lib/firebase/repositories/timeTracking").startTravelTimeEntry;
let arriveFromTravel: typeof import("@/lib/firebase/repositories/timeTracking").arriveFromTravel;
let listTimeEntries: typeof import("@/lib/firebase/repositories/timeTracking").listTimeEntries;
let signIn: typeof import("@/lib/firebase/auth").signIn;
let signOut: typeof import("@/lib/firebase/auth").signOut;

describe("Firebase time tracking repository", () => {
  beforeAll(async () => {
    vi.stubEnv("VITE_FIREBASE_USE_EMULATORS", "true");
    ({ signIn, signOut } = await import("@/lib/firebase/auth"));
    ({
      getActiveTimeEntry,
      startTimeEntry,
      stopTimeEntry,
      switchTimeEntry,
      startTravelTimeEntry,
      arriveFromTravel,
      listTimeEntries,
    } =
      await import("@/lib/firebase/repositories/timeTracking"));
    const identity = await provisionEmulatorUser({ ...credentials, role: "builder" });
    const [{ getApps, initializeApp }, { getFirestore }] = await Promise.all([
      import("../../functions/node_modules/firebase-admin/lib/app/index.js"),
      import("../../functions/node_modules/firebase-admin/lib/firestore/index.js"),
    ]);
    const adminApp = getApps().find((app) => app.name === "firebase-time-tracking-tests")
      ?? initializeApp({ projectId: "demo-jobsite-jedi" }, "firebase-time-tracking-tests");
    const adminDb = getFirestore(adminApp);
    await Promise.all([
      "time-project-1",
      "time-project-2",
      "travel-project-1",
      "travel-project-2",
      "concurrent-time-project",
    ].map((projectId) => adminDb.collection("projects").doc(projectId).set({
      builderId: identity.uid,
      ownerId: identity.uid,
      createdBy: "manager-fixture",
      name: projectId,
      description: null,
      clientName: "Time tracking test",
      address: null,
      status: "active",
      createdAt: new Date(),
      updatedAt: new Date(),
    })));
    await signIn(credentials.email, credentials.password);
  });

  afterAll(async () => {
    await signOut();
    vi.unstubAllEnvs();
  });

  test("starts and stops one owned entry", async () => {
    const started = await startTimeEntry({ projectId: "time-project-1" });
    expect(started.projectId).toBe("time-project-1");
    expect(started.clockIn).toBeInstanceOf(Date);
    expect(await getActiveTimeEntry()).toMatchObject({ id: started.id });

    await expect(startTimeEntry({ projectId: "time-project-2" })).rejects.toThrow(
      "An active time entry already exists",
    );

    const stopped = await stopTimeEntry(started.id);
    expect(stopped.clockOut).toBeInstanceOf(Date);
    expect(await getActiveTimeEntry()).toBeNull();
  });

  test("switches projects atomically from the active entry", async () => {
    const started = await startTimeEntry({ projectId: "time-project-1" });
    const next = await switchTimeEntry("time-project-2");

    expect(next.projectId).toBe("time-project-2");
    expect(next.clockOut).toBeNull();
    const previous = (await listTimeEntries()).find((entry) => entry.id === started.id);
    expect(previous?.clockOut).toBeInstanceOf(Date);
    await expect(stopTimeEntry(started.id)).rejects.toThrow("Time entry is already stopped");
    await stopTimeEntry(next.id);
  });

  test("records travel and arrives on the destination project", async () => {
    const started = await startTimeEntry({ projectId: "travel-project-1" });
    const travel = await startTravelTimeEntry({
      fromProjectId: "travel-project-1",
      toProjectId: "travel-project-2",
      fromProjectName: "Origin",
      toProjectName: "Destination",
    });

    expect(travel.notes).toBe("TRAVEL: Origin → Destination");
    expect((await getActiveTimeEntry())?.id).toBe(travel.id);
    const previous = (await listTimeEntries()).find((entry) => entry.id === started.id);
    expect(previous?.clockOut).toBeInstanceOf(Date);

    const arrived = await arriveFromTravel({
      travelEntryId: travel.id,
      toProjectId: "travel-project-2",
    });
    expect(arrived.projectId).toBe("travel-project-2");
    expect((await getActiveTimeEntry())?.id).toBe(arrived.id);
    await stopTimeEntry(arrived.id);
  });

  test("serializes concurrent starts to one active entry", async () => {
    const attempts = await Promise.allSettled([
      startTimeEntry({ projectId: "concurrent-time-project" }),
      startTimeEntry({ projectId: "concurrent-time-project" }),
    ]);
    const fulfilled = attempts.filter((result) => result.status === "fulfilled");
    const rejected = attempts.filter((result) => result.status === "rejected");

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    const active = await getActiveTimeEntry();
    expect(active?.id).toBe(fulfilled[0].status === "fulfilled" ? fulfilled[0].value.id : "");
    if (active) await stopTimeEntry(active.id);
  });

  test("rejects invalid location and oversized notes before writing", async () => {
    await expect(startTimeEntry({
      projectId: "time-project-1",
      location: { lat: 91, lng: 0 },
    })).rejects.toThrow("Location is invalid");
    await expect(startTimeEntry({
      projectId: "time-project-1",
      notes: "x".repeat(1_001),
    })).rejects.toThrow("Time entry notes are too long");
  });
});
