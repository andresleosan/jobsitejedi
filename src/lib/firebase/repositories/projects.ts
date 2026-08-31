import {
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
import { createAssignedProjectRecord } from "@/lib/firebase/functions";
import { isAppRole, isManagementRole } from "@/lib/firebase/types";

export type ProjectStatus = "active" | "finished" | "on_hold";

export interface ProjectRecord {
  id: string;
  builderId: string;
  ownerId: string;
  createdBy: string;
  name: string;
  description: string | null;
  clientName: string;
  address: string | null;
  status: ProjectStatus;
  createdAt: Date | null;
  updatedAt: Date | null;
}

export interface ProjectInput {
  builderId?: string;
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
  const ownerId = String(data.ownerId ?? "").trim();
  const builderId = String(data.builderId ?? "").trim();

  return {
    id: snapshot.id,
    builderId,
    ownerId,
    createdBy: String(data.createdBy ?? "").trim(),
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
  requireCurrentUser();
  const role = await getCurrentRole();
  if (!isManagementRole(role)) throw new Error("Manager access is required");

  const builderId = input.builderId?.trim();
  if (!builderId) throw new Error("An authorized builder is required");
  if (input.status && input.status !== "active") {
    throw new Error("New projects must start as active");
  }

  const project = doc(projectsCollection);
  await createAssignedProjectRecord({
    projectId: project.id,
    builderId,
    name: input.name.trim(),
    description: input.description?.trim() || null,
    clientName: input.clientName.trim(),
    address: input.address?.trim() || null,
  });

  const created = await getDoc(project);
  if (!created.exists()) throw new Error("Project was not created");
  return toProject(created);
};

const requireProjectManager = async () => {
  requireCurrentUser();
  if (!isManagementRole(await getCurrentRole())) {
    throw new Error("Manager access is required");
  }
};

const projectMatchesBuilder = (project: ProjectRecord, builderId: string) =>
  project.builderId === builderId
  && project.ownerId === builderId;

export const getProject = async (projectId: string): Promise<ProjectRecord | null> => {
  if (!projectId.trim()) throw new Error("Project id is required");
  const user = requireCurrentUser();
  const role = await getCurrentRole();
  const snapshot = await getDoc(doc(projectsCollection, projectId));
  if (!snapshot.exists()) return null;
  const project = toProject(snapshot);
  if (role === "builder" && !projectMatchesBuilder(project, user.uid)) return null;
  return project;
};

export const listProjects = async (status?: ProjectStatus): Promise<ProjectRecord[]> => {
  const user = requireCurrentUser();
  const role = await getCurrentRole();
  if (!isAppRole(role)) {
    throw new Error("An application role is required");
  }

  const constraints = role === "builder"
    ? [where("builderId", "==", user.uid), where("ownerId", "==", user.uid)]
    : status
      ? [where("status", "==", status)]
      : [];

  const snapshots = await getDocs(query(projectsCollection, ...constraints));
  return snapshots.docs
    .map(toProject)
    .filter((project) =>
      (!status || project.status === status)
      && (role !== "builder" || projectMatchesBuilder(project, user.uid)),
    )
    .sort((left, right) =>
      (right.createdAt?.getTime() ?? 0) - (left.createdAt?.getTime() ?? 0),
    );
};

export const updateProject = async (
  projectId: string,
  input: ProjectInput,
): Promise<ProjectRecord> => {
  validateProjectInput(input);
  await requireProjectManager();
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
