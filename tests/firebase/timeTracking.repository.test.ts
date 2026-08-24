import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";

const credentials = {
  email: `time-repository-${Date.now()}@example.test`,
  password: "Valid-password-123!",
  fullName: "Time Repository Builder",
};

let getActiveTimeEntry: typeof import("@/lib/firebase/repositories/timeTracking").getActiveTimeEntry;
let startTimeEntry: typeof import("@/lib/firebase/repositories/timeTracking").startTimeEntry;
let stopTimeEntry: typeof import("@/lib/firebase/repositories/timeTracking").stopTimeEntry;
let switchTimeEntry: typeof import("@/lib/firebase/repositories/timeTracking").switchTimeEntry;
let startTravelTimeEntry: typeof import("@/lib/firebase/repositories/timeTracking").startTravelTimeEntry;
let arriveFromTravel: typeof import("@/lib/firebase/repositories/timeTracking").arriveFromTravel;
let registerBuilder: typeof import("@/lib/firebase/auth").registerBuilder;
let signOut: typeof import("@/lib/firebase/auth").signOut;

describe("Firebase time tracking repository", () => {
  beforeAll(async () => {
    vi.stubEnv("VITE_FIREBASE_USE_EMULATORS", "true");
    ({ registerBuilder, signOut } = await import("@/lib/firebase/auth"));
    ({
      getActiveTimeEntry,
      startTimeEntry,
      stopTimeEntry,
      switchTimeEntry,
      startTravelTimeEntry,
      arriveFromTravel,
    } =
      await import("@/lib/firebase/repositories/timeTracking"));
    await registerBuilder(credentials);
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
    const previous = await stopTimeEntry(started.id);
    expect(previous.clockOut).toBeInstanceOf(Date);
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
    expect((await stopTimeEntry(started.id)).clockOut).toBeInstanceOf(Date);

    const arrived = await arriveFromTravel({
      travelEntryId: travel.id,
      toProjectId: "travel-project-2",
    });
    expect(arrived.projectId).toBe("travel-project-2");
    expect((await getActiveTimeEntry())?.id).toBe(arrived.id);
    await stopTimeEntry(arrived.id);
  });
});
