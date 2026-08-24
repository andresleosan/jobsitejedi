import {
  addDoc,
  collection,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  where,
  type DocumentData,
  type Timestamp,
} from "firebase/firestore";
import { getCurrentRole } from "@/lib/firebase/auth";
import { firebaseAuth, firebaseDb } from "@/lib/firebase/client";

export type JobStatus =
  | "approved"
  | "pending"
  | "needs_correction"
  | "waiting_review"
  | "completed";

export interface JobRecord {
  id: string;
  projectId: string;
  builderId: string;
  title: string;
  description: string | null;
  section: string | null;
  status: JobStatus;
  createdAt: Date | null;
  updatedAt: Date | null;
};

export interface JobInput {
  projectId: string;
  title: string;
  description?: string | null;
  section?: string | null;
  builderId?: string;
  status?: JobStatus;
}

const jobsCollection = collection(firebaseDb, "jobs");

const toDate = (value: unknown): Date | null => {
  if (value && typeof value === "object" && "toDate" in value) {
    return (value as Timestamp).toDate();
  }
  return value instanceof Date ? value : null;
};

const toJob = (snapshot: { id: string; data: () => DocumentData }): JobRecord => {
  const data = snapshot.data();
  const knownStatuses: JobStatus[] = [
    "approved",
    "pending",
    "needs_correction",
    "waiting_review",
    "completed",
  ];
  const status = knownStatuses.includes(data.status) ? data.status : "approved";

  return {
    id: snapshot.id,
    projectId: String(data.projectId ?? ""),
    builderId: String(data.builderId ?? ""),
    title: String(data.title ?? ""),
    description: typeof data.description === "string" ? data.description : null,
    section: typeof data.section === "string" ? data.section : null,
    status,
    createdAt: toDate(data.createdAt),
    updatedAt: toDate(data.updatedAt),
  };
};

const requireCurrentUser = () => {
  const user = firebaseAuth.currentUser;
  if (!user) throw new Error("Authentication is required");
  return user;
};

const validateJobInput = (input: JobInput) => {
  if (!input.projectId.trim() || !input.title.trim()) {
    throw new Error("Project and job title are required");
  }
}

export const createJob = async (input: JobInput): Promise<JobRecord> => {
  validateJobInput(input);
  const user = requireCurrentUser();
  const role = await getCurrentRole();
  const builderId = input.builderId?.trim() || user.uid;

  if (role === "builder" && builderId !== user.uid) {
    throw new Error("A builder can only create jobs for their own account");
  }

  const job = await addDoc(jobsCollection, {
    projectId: input.projectId.trim(),
    builderId,
    title: input.title.trim(),
    description: input.description?.trim() || null,
    section: input.section?.trim() || null,
    status: input.status ?? "approved",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  const created = await getDoc(job);
  if (!created.exists()) throw new Error("Job was not created");
  return toJob(created);
};

export const listJobsForProject = async (
  projectId: string,
  statuses: JobStatus[] = ["approved", "pending", "needs_correction", "waiting_review"],
): Promise<JobRecord[]> => {
  if (!projectId.trim()) throw new Error("Project id is required");
  const user = requireCurrentUser();
  const role = await getCurrentRole();
  const constraints = [where("projectId", "==", projectId.trim())];

  if (role === "builder") constraints.push(where("builderId", "==", user.uid));
  if (statuses.length > 0) constraints.push(where("status", "in", statuses));

  const snapshots = await getDocs(query(jobsCollection, ...constraints));
  return snapshots.docs
    .map(toJob)
    .sort((left, right) => (right.createdAt?.getTime() ?? 0) - (left.createdAt?.getTime() ?? 0));
};

export const listJobSections = async (projectId: string): Promise<string[]> => {
  const jobs = await listJobsForProject(projectId, []);
  return [...new Set(jobs.map((job) => job.section).filter((section): section is string => Boolean(section)))].sort();
};
