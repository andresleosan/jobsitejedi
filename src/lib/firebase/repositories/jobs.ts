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
import { isAppRole, isManagementRole } from "@/lib/firebase/types";

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
  reviewNotes: string | null;
  reviewedBy: string | null;
  reviewedAt: Date | null;
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
    reviewNotes: typeof data.reviewNotes === "string" ? data.reviewNotes : null,
    reviewedBy: typeof data.reviewedBy === "string" ? data.reviewedBy : null,
    reviewedAt: toDate(data.reviewedAt),
  };
};

const requireCurrentUser = () => {
  const user = firebaseAuth.currentUser;
  if (!user) throw new Error("Authentication is required");
  return user;
};

const validateJobInput = (input: JobInput) => {
  if (!input?.projectId?.trim() || !input?.title?.trim()) {
    throw new Error("Project and job title are required");
  }
  if (input.title.trim().length > 160) throw new Error("Job title is too long");
  if ((input.description?.trim().length ?? 0) > 2_000) throw new Error("Job description is too long");
  if ((input.section?.trim().length ?? 0) > 120) throw new Error("Job section is too long");
  if (input.status !== undefined && input.status !== "approved") {
    throw new Error("New jobs must start in approved status");
  }
};

const resolveProjectBuilderId = async (input: JobInput) => {
  const project = await getDoc(doc(firebaseDb, "projects", input.projectId.trim()));
  if (!project.exists()) throw new Error("Project was not found");

  const data = project.data();
  const builderId = typeof data.builderId === "string" ? data.builderId.trim() : "";
  const ownerId = typeof data.ownerId === "string" ? data.ownerId.trim() : "";
  if (!builderId || ownerId !== builderId) {
    throw new Error("The project builder assignment is inconsistent");
  }
  if (input.builderId?.trim() && input.builderId.trim() !== builderId) {
    throw new Error("The job builder must match the builder assigned to the project");
  }
  return builderId;
};

export const createJob = async (input: JobInput): Promise<JobRecord> => {
  validateJobInput(input);
  requireCurrentUser();
  const role = await getCurrentRole();
  if (!isManagementRole(role)) throw new Error("Manager access is required");
  const builderId = await resolveProjectBuilderId(input);

  const job = await addDoc(jobsCollection, {
    projectId: input.projectId.trim(),
    builderId,
    title: input.title.trim(),
    description: input.description?.trim() || null,
    section: input.section?.trim() || null,
    status: "approved",
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
  if (!isAppRole(role)) {
    throw new Error("An application role is required");
  }
  const constraints = role === "builder"
    ? [where("projectId", "==", projectId.trim()), where("builderId", "==", user.uid)]
    : [where("projectId", "==", projectId.trim())];

  const snapshots = await getDocs(query(jobsCollection, ...constraints));
  return snapshots.docs
    .map(toJob)
    .filter((job) => statuses.length === 0 || statuses.includes(job.status))
    .sort((left, right) => (right.createdAt?.getTime() ?? 0) - (left.createdAt?.getTime() ?? 0));
};

export const listJobSections = async (projectId: string): Promise<string[]> => {
  const jobs = await listJobsForProject(projectId, []);
  return [...new Set(jobs.map((job) => job.section).filter((section): section is string => Boolean(section)))].sort();
};

export const listJobsForManager = async (
  statuses: JobStatus[] = ["waiting_review", "needs_correction", "completed"],
): Promise<JobRecord[]> => {
  const role = await getCurrentRole();
  if (!isManagementRole(role)) throw new Error("Manager access is required");
  const constraints = statuses.length > 0 ? [where("status", "in", statuses)] : [];
  const snapshots = await getDocs(query(jobsCollection, ...constraints));
  return snapshots.docs
    .map(toJob)
    .sort((left, right) => (right.updatedAt?.getTime() ?? 0) - (left.updatedAt?.getTime() ?? 0));
};

export const submitJobForReview = async (jobId: string): Promise<JobRecord> => {
  const user = requireCurrentUser();
  const role = await getCurrentRole();
  if (role !== "builder") throw new Error("Only builders can submit jobs for review");
  const job = await getDoc(doc(jobsCollection, jobId.trim()));
  if (!job.exists()) throw new Error("Job was not found");
  if (job.data().builderId !== user.uid) throw new Error("You can only submit your own job");

  await updateDoc(job.ref, {
    status: "waiting_review",
    updatedAt: serverTimestamp(),
  });
  const updated = await getDoc(job.ref);
  if (!updated.exists()) throw new Error("Job was not found after submission");
  return toJob(updated);
};

export const reviewJob = async (
  jobId: string,
  status: "completed" | "needs_correction",
  reviewNotes?: string | null,
): Promise<JobRecord> => {
  const user = requireCurrentUser();
  const role = await getCurrentRole();
  if (!isManagementRole(role)) throw new Error("Manager access is required");
  if (status !== "completed" && status !== "needs_correction") {
    throw new Error("Review status is invalid");
  }

  const job = doc(jobsCollection, jobId.trim());
  const current = await getDoc(job);
  if (!current.exists()) throw new Error("Job was not found");
  if (current.data().status !== "waiting_review") {
    throw new Error("Only jobs waiting for review can be reviewed");
  }
  await updateDoc(job, {
    status,
    reviewNotes: reviewNotes?.trim() || null,
    reviewedBy: user.uid,
    reviewedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  const updated = await getDoc(job);
  if (!updated.exists()) throw new Error("Job was not found after review");
  return toJob(updated);
};
