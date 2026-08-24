import {
  connectStorageEmulator,
  deleteObject,
  getBytes,
  getStorage,
  ref,
  uploadBytes,
  type UploadMetadata,
} from "firebase/storage";
import { firebaseApp, firebaseAuth } from "./client";
import { firebaseConfig } from "./config";

const env = import.meta.env as Record<string, string | undefined>;
const useEmulators = env.VITE_FIREBASE_USE_EMULATORS === "true";

export const firebaseStorage = getStorage(firebaseApp);

if (useEmulators) {
  connectStorageEmulator(
    firebaseStorage,
    "127.0.0.1",
    firebaseConfig.emulators.storage,
  );
}

const requireCurrentUser = () => {
  if (!firebaseAuth.currentUser) throw new Error("Authentication is required");
  return firebaseAuth.currentUser;
};

const normalizePath = (path: string): string => {
  if (typeof path !== "string" || !path.trim()) {
    throw new Error("Storage path is required");
  }

  const segments = path.split("/").map((segment) => segment.trim());
  if (
    segments.some(
      (segment) => !segment || segment === "." || segment === ".." || segment.includes("\\"),
    )
  ) {
    throw new Error("Storage path contains an invalid segment");
  }

  return segments.join("/");
};

export const getThumbnailPath = (path: string): string => {
  const normalized = normalizePath(path);
  const segments = normalized.split("/");
  const fileName = segments.pop();
  if (!fileName) throw new Error("Storage path must include a file name");
  return [...segments, "thumbnails", fileName].join("/");
};

export const buildPrivateStoragePath = (...segments: string[]): string =>
  normalizePath(segments.join("/"));

export const uploadPrivateFile = async (
  path: string,
  file: Blob | Uint8Array,
  metadata?: UploadMetadata,
): Promise<string> => {
  requireCurrentUser();
  const normalized = normalizePath(path);
  await uploadBytes(ref(firebaseStorage, normalized), file, metadata);
  return normalized;
};

export const downloadPrivateFile = async (path: string): Promise<ArrayBuffer> => {
  requireCurrentUser();
  return getBytes(ref(firebaseStorage, normalizePath(path)));
};

export const createPrivateObjectUrl = async (
  path: string,
  contentType = "application/octet-stream",
): Promise<string> => {
  const bytes = await downloadPrivateFile(path);
  return URL.createObjectURL(new Blob([bytes], { type: contentType }));
};

export const deletePrivateFile = async (path: string): Promise<void> => {
  requireCurrentUser();
  await deleteObject(ref(firebaseStorage, normalizePath(path)));
};
