import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  updateDoc,
  where,
  type DocumentData,
  type Timestamp,
} from "firebase/firestore";
import { getCurrentRole } from "@/lib/firebase/auth";
import { firebaseAuth, firebaseDb } from "@/lib/firebase/client";

export type ProjectStatus = "active" | "finished" | "on_hold";

export interface ProjectRecord {
  id: string;
  ownerId: string;
  name: string;
  description: string | null;
  clientName: string;
  address: string | null;
  status: ProjectStatus;
  createdAt: Date | null;
  updatedAt: Date | null;
}

export interface ProjectInput {
  name: string;
  description?: string | null;
  clientName: string;
  address?: string | null;
  status?: ProjectStatus;
}

const projectsCollection = collection(firebaseDb, "projects");

const toDate = (value: unknown): Date | null => {
  if (value && typeof value === "object" && "toDate" in value) {
    return (value as Timestamp).toDate();
  }

  return value instanceof Date ? value : null;
};

const toProject = (snapshot: { id: string; data: () => DocumentData }): ProjectRecord => {
  const data = snapshot.data();

  return {
    id: snapshot.id,
    ownerId: String(data.ownerId ?? ""),
    name: String(data.name ?? ""),
    description: typeof data.description === "string" ? data.description : null,
    clientName: String(data.clientName ?? ""),
    address: typeof data.address === "string" ? data.address : null,
    status:
      data.status === "finished" || data.status === "on_hold"
        ? data.status
        : "active",
    createdAt: toDate(data.createdAt),
    updatedAt: toDate(data.updatedAt),
  };
};

const requireCurrentUser = () => {
  const user = firebaseAuth.currentUser;
  if (!user) throw new Error("Authentication is required");
  return user;
};

const validateProjectInput = (input: ProjectInput) => {
  if (
    !input ||
    typeof input.name !== "string" ||
    !input.name.trim() ||
    typeof input.clientName !== "string" ||
    !input.clientName.trim()
  ) {
    throw new Error("Project name and client are required");
  }
};

export const createProject = async (input: ProjectInput): Promise<ProjectRecord> => {
  validateProjectInput(input);
  const user = requireCurrentUser();
  const project = await addDoc(projectsCollection, {
    ownerId: user.uid,
    name: input.name.trim(),
    description: input.description?.trim() || null,
    clientName: input.clientName.trim(),
    address: input.address?.trim() || null,
    status: input.status ?? "active",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  const created = await getDoc(project);
  if (!created.exists()) throw new Error("Project was not created");
  return toProject(created);
};

export const getProject = async (projectId: string): Promise<ProjectRecord | null> => {
  if (!projectId.trim()) throw new Error("Project id is required");
  requireCurrentUser();
  const snapshot = await getDoc(doc(projectsCollection, projectId));
  return snapshot.exists() ? toProject(snapshot) : null;
};

export const listProjects = async (status?: ProjectStatus): Promise<ProjectRecord[]> => {
  const user = requireCurrentUser();
  const role = await getCurrentRole();
  const constraints = [];

  if (role === "builder") constraints.push(where("ownerId", "==", user.uid));
  if (status) constraints.push(where("status", "==", status));

  const snapshots = await getDocs(query(projectsCollection, ...constraints));
  return snapshots.docs
    .map(toProject)
    .sort((left, right) =>
      (right.createdAt?.getTime() ?? 0) - (left.createdAt?.getTime() ?? 0),
    );
};

export const updateProject = async (
  projectId: string,
  input: ProjectInput,
): Promise<ProjectRecord> => {
  validateProjectInput(input);
  requireCurrentUser();
  await updateDoc(doc(projectsCollection, projectId), {
    name: input.name.trim(),
    description: input.description?.trim() || null,
    clientName: input.clientName.trim(),
    address: input.address?.trim() || null,
    ...(input.status ? { status: input.status } : {}),
    updatedAt: serverTimestamp(),
  });

  const updated = await getProject(projectId);
  if (!updated) throw new Error("Project was not found after update");
  return updated;
};
