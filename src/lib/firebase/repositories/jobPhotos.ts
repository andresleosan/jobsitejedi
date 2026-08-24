import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  where,
  writeBatch,
  type DocumentData,
  type Timestamp,
} from "firebase/firestore";
import { getCurrentRole } from "@/lib/firebase/auth";
import { firebaseAuth, firebaseDb } from "@/lib/firebase/client";
import {
  buildPrivateStoragePath,
  createPrivateObjectUrl,
  deletePrivateFile,
  getThumbnailPath,
  uploadPrivateFile,
} from "@/lib/firebase/storage";

export type JobPhotoKind = "reference" | "completion" | "feedback";

export interface JobPhotoRecord {
  id: string;
  jobId: string;
  builderId: string;
  uploadedBy: string;
  kind: JobPhotoKind;
  originalPath: string;
  thumbnailPath: string;
  fileName: string;
  contentType: string;
  createdAt: Date | null;
}

export interface UploadJobPhotoInput {
  jobId: string;
  kind: JobPhotoKind;
  fileName: string;
  contentType: string;
  file: Blob | Uint8Array;
  thumbnail: Blob | Uint8Array;
}

const photosCollection = collection(firebaseDb, "jobPhotos");
const jobsCollection = collection(firebaseDb, "jobs");

const toDate = (value: unknown): Date | null => {
  if (value && typeof value === "object" && "toDate" in value) {
    return (value as Timestamp).toDate();
  }
  return value instanceof Date ? value : null;
};

const isPhotoKind = (value: unknown): value is JobPhotoKind =>
  value === "reference" || value === "completion" || value === "feedback";

const toPhoto = (snapshot: { id: string; data: () => DocumentData }): JobPhotoRecord => {
  const data = snapshot.data();
  return {
    id: snapshot.id,
    jobId: String(data.jobId ?? ""),
    builderId: String(data.builderId ?? ""),
    uploadedBy: String(data.uploadedBy ?? ""),
    kind: isPhotoKind(data.kind) ? data.kind : "reference",
    originalPath: String(data.originalPath ?? ""),
    thumbnailPath: String(data.thumbnailPath ?? ""),
    fileName: String(data.fileName ?? ""),
    contentType: String(data.contentType ?? "application/octet-stream"),
    createdAt: toDate(data.createdAt),
  };
};

const requireCurrentUser = () => {
  const user = firebaseAuth.currentUser;
  if (!user) throw new Error("Authentication is required");
  return user;
};

const requireJob = async (jobId: string) => {
  if (typeof jobId !== "string" || !jobId.trim()) throw new Error("Job id is required");
  const snapshot = await getDoc(doc(jobsCollection, jobId.trim()));
  if (!snapshot.exists()) throw new Error("Job was not found");
  const builderId = snapshot.data().builderId;
  if (typeof builderId !== "string" || !builderId.trim()) {
    throw new Error("Job owner is missing");
  }
  return { id: snapshot.id, builderId };
};

const safeFileName = (fileName: string): string => {
  const candidate = fileName.split(/[\\/]/).pop()?.trim() ?? "";
  const normalized = candidate.replace(/[^a-zA-Z0-9._-]/g, "_");
  if (!normalized || normalized === "." || normalized === "..") {
    throw new Error("Photo file name is required");
  }
  return normalized;
};

export const uploadJobPhoto = async (
  input: UploadJobPhotoInput,
): Promise<JobPhotoRecord> => {
  const user = requireCurrentUser();
  const role = await getCurrentRole();
  const job = await requireJob(input.jobId);
  if (!isPhotoKind(input.kind)) throw new Error("Photo kind is invalid");
  if (!input.contentType.startsWith("image/")) throw new Error("Only image files are supported");

  if (role === "builder" && job.builderId !== user.uid) {
    throw new Error("A builder can only upload photos for their own job");
  }

  const photo = doc(photosCollection);
  const fileName = safeFileName(input.fileName);
  const originalPath = buildPrivateStoragePath(
    "jobs",
    job.id,
    job.builderId,
    input.kind,
    `${photo.id}-${fileName}`,
  );
  const thumbnailPath = getThumbnailPath(originalPath);

  await uploadPrivateFile(originalPath, input.file, { contentType: input.contentType });
  try {
    await uploadPrivateFile(thumbnailPath, input.thumbnail, { contentType: "image/jpeg" });
    await writeBatch(firebaseDb)
      .set(photo, {
        jobId: job.id,
        builderId: job.builderId,
        uploadedBy: user.uid,
        kind: input.kind,
        originalPath,
        thumbnailPath,
        fileName,
        contentType: input.contentType,
        createdAt: serverTimestamp(),
      })
      .commit();
  } catch (error) {
    await Promise.allSettled([deletePrivateFile(originalPath), deletePrivateFile(thumbnailPath)]);
    throw error;
  }

  const created = await getDoc(photo);
  if (!created.exists()) throw new Error("Photo reference was not created");
  return toPhoto(created);
};

export const listJobPhotos = async (
  jobId: string,
  kind?: JobPhotoKind,
): Promise<JobPhotoRecord[]> => {
  const user = requireCurrentUser();
  const role = await getCurrentRole();
  const constraints = [where("jobId", "==", jobId.trim())];
  if (role === "builder") constraints.push(where("builderId", "==", user.uid));
  if (kind) constraints.push(where("kind", "==", kind));

  const snapshots = await getDocs(query(photosCollection, ...constraints));
  return snapshots.docs
    .map(toPhoto)
    .sort((left, right) => (right.createdAt?.getTime() ?? 0) - (left.createdAt?.getTime() ?? 0));
};

export const createJobPhotoObjectUrl = async (
  photo: JobPhotoRecord,
  thumbnail = true,
): Promise<string> =>
  createPrivateObjectUrl(
    thumbnail ? photo.thumbnailPath : photo.originalPath,
    thumbnail ? "image/jpeg" : photo.contentType,
  );

export const deleteJobPhoto = async (photoId: string): Promise<void> => {
  requireCurrentUser();
  if (!photoId.trim()) throw new Error("Photo id is required");
  const photo = doc(photosCollection, photoId.trim());
  const snapshot = await getDoc(photo);
  if (!snapshot.exists()) throw new Error("Photo was not found");
  const record = toPhoto(snapshot);

  await Promise.allSettled([
    deletePrivateFile(record.originalPath),
    deletePrivateFile(record.thumbnailPath),
  ]);
  await writeBatch(firebaseDb).delete(photo).commit();
};
