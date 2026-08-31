import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  runTransaction,
  serverTimestamp,
  where,
  type DocumentData,
  type Timestamp,
} from "firebase/firestore";
import { getCurrentRole } from "@/lib/firebase/auth";
import { isManagementRole } from "@/lib/firebase/types";
import { firebaseAuth, firebaseDb } from "@/lib/firebase/client";

export interface TimeEntry {
  id: string;
  builderId: string;
  projectId: string;
  clockIn: Date | null;
  clockOut: Date | null;
  location?: { lat: number; lng: number };
  notes: string | null;
}

export interface StartTimeEntryInput {
  projectId: string;
  location?: { lat: number; lng: number };
  notes?: string | null;
}

export interface StartTravelInput {
  fromProjectId: string;
  toProjectId: string;
  fromProjectName?: string;
  toProjectName?: string;
  location?: { lat: number; lng: number };
}

export interface ArriveFromTravelInput {
  travelEntryId: string;
  toProjectId: string;
  location?: { lat: number; lng: number };
}

const entriesCollection = collection(firebaseDb, "timeTracking");
const activeEntriesCollection = collection(firebaseDb, "activeTimeEntries");
const switchesCollection = collection(firebaseDb, "projectSwitches");

const toDate = (value: unknown): Date | null => {
  if (value && typeof value === "object" && "toDate" in value) {
    return (value as Timestamp).toDate();
  }
  return value instanceof Date ? value : null;
};

const toEntry = (snapshot: { id: string; data: () => DocumentData }): TimeEntry => {
  const data = snapshot.data();
  const location = data.location;
  return {
    id: snapshot.id,
    builderId: String(data.builderId ?? ""),
    projectId: String(data.projectId ?? ""),
    clockIn: toDate(data.clockIn),
    clockOut: toDate(data.clockOut),
    location:
      location && typeof location.lat === "number" && typeof location.lng === "number"
        ? { lat: location.lat, lng: location.lng }
        : undefined,
    notes: typeof data.notes === "string" ? data.notes : null,
  };
};

const requireCurrentUser = () => {
  const user = firebaseAuth.currentUser;
  if (!user) throw new Error("Authentication is required");
  return user;
};

const requireCurrentBuilder = async () => {
  const user = requireCurrentUser();
  if ((await getCurrentRole()) !== "builder") {
    throw new Error("Only builders can record time");
  }
  return user;
};

const normalizeProjectId = (projectId: string): string => {
  if (typeof projectId !== "string" || !projectId.trim()) {
    throw new Error("Project id is required");
  }
  const normalized = projectId.trim();
  if (normalized.length > 128 || normalized.includes("/")) {
    throw new Error("Project id is invalid");
  }
  return normalized;
};

const normalizeLocation = (
  location?: { lat: number; lng: number },
): { lat: number; lng: number } | null => {
  if (location === undefined) return null;
  if (
    !Number.isFinite(location.lat)
    || !Number.isFinite(location.lng)
    || location.lat < -90
    || location.lat > 90
    || location.lng < -180
    || location.lng > 180
  ) {
    throw new Error("Location is invalid");
  }
  return { lat: location.lat, lng: location.lng };
};

const normalizeNotes = (notes?: string | null): string | null => {
  if (notes == null) return null;
  if (typeof notes !== "string") throw new Error("Time entry notes are invalid");
  const normalized = notes.trim();
  if (normalized.length > 1_000) throw new Error("Time entry notes are too long");
  return normalized || null;
};

const normalizeTravelLabel = (value: string | undefined, fallback: string): string => {
  const normalized = value?.trim() || fallback;
  if (normalized.length > 160) throw new Error("Project name is too long");
  return normalized;
};

const buildEntryData = (
  builderId: string,
  projectId: string,
  location: { lat: number; lng: number } | null,
  notes: string | null,
) => ({
  builderId,
  projectId,
  clockIn: serverTimestamp(),
  clockOut: null,
  location,
  notes,
});

const buildActiveMarker = (builderId: string, entryId: string, projectId: string) => ({
  builderId,
  entryId,
  projectId,
  updatedAt: serverTimestamp(),
});

const getLegacyActiveEntries = async (builderId: string): Promise<TimeEntry[]> => {
  const snapshots = await getDocs(
    query(
      entriesCollection,
      where("builderId", "==", builderId),
      where("clockOut", "==", null),
    ),
  );
  return snapshots.docs.map(toEntry);
};

export const getActiveTimeEntry = async (): Promise<TimeEntry | null> => {
  const user = requireCurrentUser();
  const marker = await getDoc(doc(activeEntriesCollection, user.uid));
  if (marker.exists()) {
    const data = marker.data();
    if (data.builderId !== user.uid || typeof data.entryId !== "string" || !data.entryId) {
      throw new Error("The active time entry marker is invalid");
    }
    const active = await getDoc(doc(entriesCollection, data.entryId));
    if (!active.exists() || active.data().builderId !== user.uid || active.data().clockOut !== null) {
      throw new Error("The active time entry marker is stale");
    }
    return toEntry(active);
  }

  // Compatibility path for active records created before the transactional marker existed.
  const legacy = await getLegacyActiveEntries(user.uid);
  if (legacy.length > 1) {
    throw new Error("Multiple active time entries require reconciliation");
  }
  return legacy[0] ?? null;
};

export const listTimeEntries = async (projectId?: string): Promise<TimeEntry[]> => {
  const user = requireCurrentUser();
  const role = await getCurrentRole();
  const normalizedProjectId = projectId?.trim();
  const constraints = isManagementRole(role)
    ? normalizedProjectId ? [where("projectId", "==", normalizeProjectId(normalizedProjectId))] : []
    : [
        where("builderId", "==", user.uid),
        ...(normalizedProjectId
          ? [where("projectId", "==", normalizeProjectId(normalizedProjectId))]
          : []),
      ];
  const snapshots = await getDocs(query(entriesCollection, ...constraints));
  return snapshots.docs
    .map(toEntry)
    .sort((left, right) => (right.clockIn?.getTime() ?? 0) - (left.clockIn?.getTime() ?? 0));
};

export const startTimeEntry = async (input: StartTimeEntryInput): Promise<TimeEntry> => {
  const projectId = normalizeProjectId(input.projectId);
  const location = normalizeLocation(input.location);
  const notes = normalizeNotes(input.notes);
  const user = await requireCurrentBuilder();
  if (await getActiveTimeEntry()) throw new Error("An active time entry already exists");

  const entry = doc(entriesCollection);
  const marker = doc(activeEntriesCollection, user.uid);
  await runTransaction(firebaseDb, async (transaction) => {
    const currentMarker = await transaction.get(marker);
    if (currentMarker.exists()) throw new Error("An active time entry already exists");
    transaction.set(entry, buildEntryData(user.uid, projectId, location, notes));
    transaction.set(marker, buildActiveMarker(user.uid, entry.id, projectId));
  });

  const created = await getDoc(entry);
  if (!created.exists()) throw new Error("Time entry was not created");
  return toEntry(created);
};

export const stopTimeEntry = async (entryId: string): Promise<TimeEntry> => {
  const normalizedEntryId = entryId.trim();
  if (!normalizedEntryId || normalizedEntryId.includes("/")) {
    throw new Error("Time entry id is required");
  }
  const user = await requireCurrentBuilder();
  const entry = doc(entriesCollection, normalizedEntryId);
  const marker = doc(activeEntriesCollection, user.uid);

  await runTransaction(firebaseDb, async (transaction) => {
    const currentEntry = await transaction.get(entry);
    const currentMarker = await transaction.get(marker);
    if (!currentEntry.exists() || currentEntry.data().builderId !== user.uid) {
      throw new Error("Time entry was not found");
    }
    if (currentEntry.data().clockOut !== null) throw new Error("Time entry is already stopped");
    if (currentMarker.exists() && currentMarker.data().entryId !== entry.id) {
      throw new Error("The time entry is no longer active");
    }

    transaction.update(entry, { clockOut: serverTimestamp() });
    if (currentMarker.exists()) transaction.delete(marker);
  });

  const stopped = await getDoc(entry);
  if (!stopped.exists()) throw new Error("Time entry was not found after stopping");
  return toEntry(stopped);
};

export const switchTimeEntry = async (
  newProjectId: string,
  input: Omit<StartTimeEntryInput, "projectId"> = {},
): Promise<TimeEntry> => {
  const projectId = normalizeProjectId(newProjectId);
  const location = normalizeLocation(input.location);
  const notes = normalizeNotes(input.notes);
  const user = await requireCurrentBuilder();
  const active = await getActiveTimeEntry();
  if (!active) return startTimeEntry({ ...input, projectId });
  if (active.projectId === projectId) {
    throw new Error("The active time entry already belongs to this project");
  }

  const current = doc(entriesCollection, active.id);
  const next = doc(entriesCollection);
  const marker = doc(activeEntriesCollection, user.uid);
  await runTransaction(firebaseDb, async (transaction) => {
    const currentEntry = await transaction.get(current);
    const currentMarker = await transaction.get(marker);
    if (
      !currentEntry.exists()
      || currentEntry.data().builderId !== user.uid
      || currentEntry.data().clockOut !== null
    ) {
      throw new Error("The active time entry changed");
    }
    if (currentMarker.exists() && currentMarker.data().entryId !== current.id) {
      throw new Error("The active time entry changed");
    }

    transaction.update(current, { clockOut: serverTimestamp() });
    transaction.set(next, buildEntryData(user.uid, projectId, location, notes));
    transaction.set(marker, buildActiveMarker(user.uid, next.id, projectId));
  });

  const created = await getDoc(next);
  if (!created.exists()) throw new Error("Time entry switch was not completed");
  return toEntry(created);
};

export const startTravelTimeEntry = async (input: StartTravelInput): Promise<TimeEntry> => {
  const fromProjectId = normalizeProjectId(input.fromProjectId);
  const toProjectId = normalizeProjectId(input.toProjectId);
  if (fromProjectId === toProjectId) throw new Error("The destination project must be different");
  const location = normalizeLocation(input.location);
  const fromProjectName = normalizeTravelLabel(input.fromProjectName, fromProjectId);
  const toProjectName = normalizeTravelLabel(input.toProjectName, toProjectId);
  const user = await requireCurrentBuilder();
  const active = await getActiveTimeEntry();
  if (!active || active.projectId !== fromProjectId) {
    throw new Error("The active time entry does not belong to the current project");
  }

  const current = doc(entriesCollection, active.id);
  const travel = doc(entriesCollection);
  const marker = doc(activeEntriesCollection, user.uid);
  const projectSwitch = doc(switchesCollection, travel.id);
  await runTransaction(firebaseDb, async (transaction) => {
    const currentEntry = await transaction.get(current);
    const currentMarker = await transaction.get(marker);
    if (
      !currentEntry.exists()
      || currentEntry.data().builderId !== user.uid
      || currentEntry.data().clockOut !== null
      || currentEntry.data().projectId !== fromProjectId
    ) {
      throw new Error("The active time entry changed");
    }
    if (currentMarker.exists() && currentMarker.data().entryId !== current.id) {
      throw new Error("The active time entry changed");
    }

    transaction.update(current, { clockOut: serverTimestamp() });
    transaction.set(travel, buildEntryData(
      user.uid,
      fromProjectId,
      location,
      `TRAVEL: ${fromProjectName} → ${toProjectName}`,
    ));
    transaction.set(marker, buildActiveMarker(user.uid, travel.id, fromProjectId));
    transaction.set(projectSwitch, {
      builderId: user.uid,
      fromProjectId,
      toProjectId,
      travelEntryId: travel.id,
      travelTimeMinutes: null,
      switchedAt: serverTimestamp(),
      arrivedAt: null,
    });
  });

  const created = await getDoc(travel);
  if (!created.exists()) throw new Error("Travel time entry was not created");
  return toEntry(created);
};

export const arriveFromTravel = async (input: ArriveFromTravelInput): Promise<TimeEntry> => {
  const travelEntryId = input.travelEntryId.trim();
  if (!travelEntryId || travelEntryId.includes("/")) throw new Error("Travel entry id is required");
  const toProjectId = normalizeProjectId(input.toProjectId);
  const location = normalizeLocation(input.location);
  const user = await requireCurrentBuilder();
  const active = await getActiveTimeEntry();
  if (!active || active.id !== travelEntryId) {
    throw new Error("The travel entry is no longer active");
  }

  const travel = doc(entriesCollection, travelEntryId);
  const next = doc(entriesCollection);
  const marker = doc(activeEntriesCollection, user.uid);
  const projectSwitch = doc(switchesCollection, travelEntryId);
  await runTransaction(firebaseDb, async (transaction) => {
    const currentTravel = await transaction.get(travel);
    const currentMarker = await transaction.get(marker);
    const currentSwitch = await transaction.get(projectSwitch);
    if (
      !currentTravel.exists()
      || currentTravel.data().builderId !== user.uid
      || currentTravel.data().clockOut !== null
    ) {
      throw new Error("The travel entry changed");
    }
    if (currentMarker.exists() && currentMarker.data().entryId !== travel.id) {
      throw new Error("The travel entry changed");
    }
    if (
      !currentSwitch.exists()
      || currentSwitch.data().builderId !== user.uid
      || currentSwitch.data().travelEntryId !== travel.id
      || currentSwitch.data().toProjectId !== toProjectId
      || currentSwitch.data().arrivedAt != null
    ) {
      throw new Error("The project switch is invalid");
    }

    transaction.update(travel, { clockOut: serverTimestamp() });
    transaction.set(next, buildEntryData(user.uid, toProjectId, location, null));
    transaction.set(marker, buildActiveMarker(user.uid, next.id, toProjectId));
    transaction.update(projectSwitch, { arrivedAt: serverTimestamp() });
  });

  const created = await getDoc(next);
  if (!created.exists()) throw new Error("Arrival was not completed");
  return toEntry(created);
};
