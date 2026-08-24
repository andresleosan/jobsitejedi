import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
  type DocumentData,
  type Timestamp,
} from "firebase/firestore";
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

const validateProjectId = (projectId: string) => {
  if (typeof projectId !== "string" || !projectId.trim()) {
    throw new Error("Project id is required");
  }
};

export const getActiveTimeEntry = async (): Promise<TimeEntry | null> => {
  const user = requireCurrentUser();
  const snapshots = await getDocs(
    query(
      entriesCollection,
      where("builderId", "==", user.uid),
      where("clockOut", "==", null),
    ),
  );
  const active = snapshots.docs[0];
  return active ? toEntry(active) : null;
};

export const startTimeEntry = async (input: StartTimeEntryInput): Promise<TimeEntry> => {
  validateProjectId(input.projectId);
  const user = requireCurrentUser();
  const active = await getActiveTimeEntry();
  if (active) throw new Error("An active time entry already exists");

  const entry = doc(entriesCollection);
  await writeBatch(firebaseDb)
    .set(entry, {
      builderId: user.uid,
      projectId: input.projectId.trim(),
      clockIn: serverTimestamp(),
      clockOut: null,
      location: input.location ?? null,
      notes: input.notes?.trim() || null,
    })
    .commit();

  const created = await getDoc(entry);
  if (!created.exists()) throw new Error("Time entry was not created");
  return toEntry(created);
};

export const stopTimeEntry = async (entryId: string): Promise<TimeEntry> => {
  if (!entryId.trim()) throw new Error("Time entry id is required");
  requireCurrentUser();
  const entry = doc(entriesCollection, entryId);
  await updateDoc(entry, { clockOut: serverTimestamp() });
  const stopped = await getDoc(entry);
  if (!stopped.exists()) throw new Error("Time entry was not found after stopping");
  return toEntry(stopped);
};

export const switchTimeEntry = async (
  newProjectId: string,
  input: Omit<StartTimeEntryInput, "projectId"> = {},
): Promise<TimeEntry> => {
  validateProjectId(newProjectId);
  const user = requireCurrentUser();
  const active = await getActiveTimeEntry();
  if (!active) return startTimeEntry({ ...input, projectId: newProjectId });
  if (active.projectId === newProjectId.trim()) {
    throw new Error("The active time entry already belongs to this project");
  }

  const next = doc(entriesCollection);
  await writeBatch(firebaseDb)
    .update(doc(entriesCollection, active.id), { clockOut: serverTimestamp() })
    .set(next, {
      builderId: user.uid,
      projectId: newProjectId.trim(),
      clockIn: serverTimestamp(),
      clockOut: null,
      location: input.location ?? null,
      notes: input.notes?.trim() || null,
    })
    .commit();

  const created = await getDoc(next);
  if (!created.exists()) throw new Error("Time entry switch was not completed");
  return toEntry(created);
};

export const startTravelTimeEntry = async (
  input: StartTravelInput,
): Promise<TimeEntry> => {
  validateProjectId(input.fromProjectId);
  validateProjectId(input.toProjectId);
  if (input.fromProjectId.trim() === input.toProjectId.trim()) {
    throw new Error("The destination project must be different");
  }

  const user = requireCurrentUser();
  const active = await getActiveTimeEntry();
  if (!active || active.projectId !== input.fromProjectId.trim()) {
    throw new Error("The active time entry does not belong to the current project");
  }

  const travel = doc(entriesCollection);
  const projectSwitch = doc(switchesCollection, travel.id);
  await writeBatch(firebaseDb)
    .update(doc(entriesCollection, active.id), { clockOut: serverTimestamp() })
    .set(travel, {
      builderId: user.uid,
      projectId: input.fromProjectId.trim(),
      clockIn: serverTimestamp(),
      clockOut: null,
      location: input.location ?? null,
      notes: `TRAVEL: ${input.fromProjectName ?? input.fromProjectId} → ${input.toProjectName ?? input.toProjectId}`,
    })
    .set(projectSwitch, {
      builderId: user.uid,
      fromProjectId: input.fromProjectId.trim(),
      toProjectId: input.toProjectId.trim(),
      travelEntryId: travel.id,
      travelTimeMinutes: null,
      switchedAt: serverTimestamp(),
    })
    .commit();

  const created = await getDoc(travel);
  if (!created.exists()) throw new Error("Travel time entry was not created");
  return toEntry(created);
};

export const arriveFromTravel = async (
  input: ArriveFromTravelInput,
): Promise<TimeEntry> => {
  if (!input.travelEntryId.trim()) throw new Error("Travel entry id is required");
  validateProjectId(input.toProjectId);

  const user = requireCurrentUser();
  const active = await getActiveTimeEntry();
  if (!active || active.id !== input.travelEntryId) {
    throw new Error("The travel entry is no longer active");
  }

  const travelStart = active.clockIn?.getTime();
  const travelMinutes = travelStart
    ? Math.max(0, Math.round((Date.now() - travelStart) / 60000))
    : null;
  const next = doc(entriesCollection);
  const projectSwitch = doc(switchesCollection, input.travelEntryId);
  await writeBatch(firebaseDb)
    .update(doc(entriesCollection, active.id), {
      clockOut: serverTimestamp(),
      location: input.location ?? active.location ?? null,
    })
    .update(projectSwitch, { travelTimeMinutes: travelMinutes })
    .set(next, {
      builderId: user.uid,
      projectId: input.toProjectId.trim(),
      clockIn: serverTimestamp(),
      clockOut: null,
      location: input.location ?? null,
      notes: null,
    })
    .commit();

  const created = await getDoc(next);
  if (!created.exists()) throw new Error("Arrival was not completed");
  return toEntry(created);
};
