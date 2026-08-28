import {
  collection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  setDoc,
  type DocumentData,
  type Timestamp,
} from "firebase/firestore";
import { getCurrentRole } from "@/lib/firebase/auth";
import { firebaseAuth, firebaseDb } from "@/lib/firebase/client";

export interface SupplierRecord {
  id: string;
  name: string;
  normalizedName: string;
  createdBy: string;
  createdAt: Date | null;
  updatedAt: Date | null;
}

export interface SupplierInput {
  name: string;
}

const suppliersCollection = collection(firebaseDb, "suppliers");

const toDate = (value: unknown): Date | null => {
  if (value && typeof value === "object" && "toDate" in value) {
    return (value as Timestamp).toDate();
  }
  return value instanceof Date ? value : null;
};

const requireCurrentUser = () => {
  const user = firebaseAuth.currentUser;
  if (!user) throw new Error("Authentication is required");
  return user;
};

const requireManager = async () => {
  requireCurrentUser();
  if ((await getCurrentRole()) !== "manager") throw new Error("Manager access is required");
};

export const normalizeSupplierName = (name: string): string => name
  .trim()
  .normalize("NFKD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, "-")
  .replace(/^-+|-+$/g, "");

const validateSupplierName = (name: unknown): string => {
  if (typeof name !== "string" || !name.trim() || name.trim().length > 120) {
    throw new Error("Supplier name is required and must be 120 characters or fewer");
  }
  const normalizedName = normalizeSupplierName(name);
  if (!normalizedName) throw new Error("Supplier name must contain letters or numbers");
  return normalizedName;
};

const toSupplier = (snapshot: { id: string; data: () => DocumentData }): SupplierRecord => {
  const data = snapshot.data();
  return {
    id: snapshot.id,
    name: String(data.name ?? ""),
    normalizedName: String(data.normalizedName ?? snapshot.id),
    createdBy: String(data.createdBy ?? ""),
    createdAt: toDate(data.createdAt),
    updatedAt: toDate(data.updatedAt),
  };
};

export const getSupplier = async (supplierId: string): Promise<SupplierRecord | null> => {
  requireCurrentUser();
  const normalizedId = supplierId.trim();
  if (!normalizedId) throw new Error("Supplier id is required");
  const snapshot = await getDoc(doc(suppliersCollection, normalizedId));
  return snapshot.exists() ? toSupplier(snapshot) : null;
};

export const listSuppliers = async (): Promise<SupplierRecord[]> => {
  requireCurrentUser();
  const snapshot = await getDocs(query(suppliersCollection, orderBy("name")));
  return snapshot.docs.map(toSupplier);
};

export const createSupplier = async (input: SupplierInput): Promise<SupplierRecord> => {
  await requireManager();
  const normalizedName = validateSupplierName(input?.name);
  const supplier = doc(suppliersCollection, normalizedName);
  const existing = await getDoc(supplier);
  if (existing.exists()) return toSupplier(existing);

  const user = requireCurrentUser();
  await setDoc(supplier, {
    name: input.name.trim(),
    normalizedName,
    createdBy: user.uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  const created = await getDoc(supplier);
  if (!created.exists()) throw new Error("Supplier was not created");
  return toSupplier(created);
};

export const updateSupplier = async (
  supplierId: string,
  input: SupplierInput,
): Promise<SupplierRecord> => {
  await requireManager();
  const normalizedId = supplierId.trim();
  if (!normalizedId) throw new Error("Supplier id is required");
  const normalizedName = validateSupplierName(input?.name);
  if (normalizedName !== normalizedId) {
    throw new Error("Supplier identity cannot change; create a new supplier instead");
  }
  await updateDoc(doc(suppliersCollection, normalizedId), {
    name: input.name.trim(),
    updatedAt: serverTimestamp(),
  });
  const updated = await getSupplier(normalizedId);
  if (!updated) throw new Error("Supplier was not found after update");
  return updated;
};

export const deleteSupplier = async (supplierId: string): Promise<void> => {
  await requireManager();
  const normalizedId = supplierId.trim();
  if (!normalizedId) throw new Error("Supplier id is required");
  throw new Error("Supplier deletion is disabled to preserve invoice history");
};
