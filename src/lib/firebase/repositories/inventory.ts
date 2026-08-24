import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  runTransaction,
  serverTimestamp,
  updateDoc,
  where,
  type DocumentData,
  type Timestamp,
} from "firebase/firestore";
import { getCurrentRole } from "@/lib/firebase/auth";
import { firebaseAuth, firebaseDb } from "@/lib/firebase/client";

export type ToolStatus = "available" | "checked_out" | "maintenance" | "retired";
export type ToolRequestStatus =
  | "pending"
  | "approved"
  | "picked_up"
  | "delivered"
  | "rejected"
  | "returned";

export interface StorageMaterialRecord {
  id: string;
  name: string;
  category: string;
  section: string | null;
  quantity: number;
  unit: string;
  minStockLevel: number;
  notes: string | null;
  photoUrl: string | null;
  createdBy: string;
  createdAt: Date | null;
  updatedAt: Date | null;
}

export interface StorageToolRecord {
  id: string;
  name: string;
  category: string;
  section: string | null;
  serialNumber: string | null;
  condition: string | null;
  status: ToolStatus;
  notes: string | null;
  createdBy: string;
  createdAt: Date | null;
  updatedAt: Date | null;
}

export interface ToolRequestRecord {
  id: string;
  toolId: string;
  projectId: string;
  requestedBy: string;
  requestedAt: Date | null;
  status: ToolRequestStatus;
  notes: string | null;
  approvedBy: string | null;
  approvedAt: Date | null;
  pickedUpBy: string | null;
  pickedUpAt: Date | null;
  deliveredBy: string | null;
  deliveredAt: Date | null;
  returnedBy: string | null;
  returnedAt: Date | null;
  rejectionReason: string | null;
  createdAt: Date | null;
  updatedAt: Date | null;
}

export interface ToolCheckoutRecord {
  id: string;
  toolId: string;
  projectId: string;
  checkedOutBy: string;
  checkedOutAt: Date | null;
  expectedReturnDate: string | null;
  returnedAt: Date | null;
  returnedBy: string | null;
  conditionOnReturn: string | null;
  notes: string | null;
  createdAt: Date | null;
}

export interface StorageMaterialInput {
  name: string;
  category: string;
  section?: string | null;
  quantity?: number;
  unit?: string;
  minStockLevel?: number;
  notes?: string | null;
  photoUrl?: string | null;
}

export interface StorageToolInput {
  name: string;
  category: string;
  section?: string | null;
  serialNumber?: string | null;
  condition?: string | null;
  status?: ToolStatus;
  notes?: string | null;
}

const materialsCollection = collection(firebaseDb, "storageMaterials");
const toolsCollection = collection(firebaseDb, "storageTools");
const requestsCollection = collection(firebaseDb, "toolRequests");
const checkoutsCollection = collection(firebaseDb, "toolCheckouts");
const transfersCollection = collection(firebaseDb, "materialTransfers");

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

const assertNonNegative = (value: number, field: string) => {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${field} must be a non-negative number`);
};

const requireText = (value: string, field: string) => {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} is required`);
  return value.trim();
};

const toMaterial = (snapshot: { id: string; data: () => DocumentData }): StorageMaterialRecord => {
  const data = snapshot.data();
  return {
    id: snapshot.id,
    name: String(data.name ?? ""),
    category: String(data.category ?? ""),
    section: typeof data.section === "string" ? data.section : null,
    quantity: Number(data.quantity ?? 0),
    unit: String(data.unit ?? "units"),
    minStockLevel: Number(data.minStockLevel ?? 0),
    notes: typeof data.notes === "string" ? data.notes : null,
    photoUrl: typeof data.photoUrl === "string" ? data.photoUrl : null,
    createdBy: String(data.createdBy ?? ""),
    createdAt: toDate(data.createdAt),
    updatedAt: toDate(data.updatedAt),
  };
};

const toTool = (snapshot: { id: string; data: () => DocumentData }): StorageToolRecord => {
  const data = snapshot.data();
  const statuses: ToolStatus[] = ["available", "checked_out", "maintenance", "retired"];
  return {
    id: snapshot.id,
    name: String(data.name ?? ""),
    category: String(data.category ?? ""),
    section: typeof data.section === "string" ? data.section : null,
    serialNumber: typeof data.serialNumber === "string" ? data.serialNumber : null,
    condition: typeof data.condition === "string" ? data.condition : null,
    status: statuses.includes(data.status) ? data.status : "available",
    notes: typeof data.notes === "string" ? data.notes : null,
    createdBy: String(data.createdBy ?? ""),
    createdAt: toDate(data.createdAt),
    updatedAt: toDate(data.updatedAt),
  };
};

const toRequest = (snapshot: { id: string; data: () => DocumentData }): ToolRequestRecord => {
  const data = snapshot.data();
  const statuses: ToolRequestStatus[] = [
    "pending", "approved", "picked_up", "delivered", "rejected", "returned",
  ];
  return {
    id: snapshot.id,
    toolId: String(data.toolId ?? ""),
    projectId: String(data.projectId ?? ""),
    requestedBy: String(data.requestedBy ?? ""),
    requestedAt: toDate(data.requestedAt),
    status: statuses.includes(data.status) ? data.status : "pending",
    notes: typeof data.notes === "string" ? data.notes : null,
    approvedBy: typeof data.approvedBy === "string" ? data.approvedBy : null,
    approvedAt: toDate(data.approvedAt),
    pickedUpBy: typeof data.pickedUpBy === "string" ? data.pickedUpBy : null,
    pickedUpAt: toDate(data.pickedUpAt),
    deliveredBy: typeof data.deliveredBy === "string" ? data.deliveredBy : null,
    deliveredAt: toDate(data.deliveredAt),
    returnedBy: typeof data.returnedBy === "string" ? data.returnedBy : null,
    returnedAt: toDate(data.returnedAt),
    rejectionReason: typeof data.rejectionReason === "string" ? data.rejectionReason : null,
    createdAt: toDate(data.createdAt),
    updatedAt: toDate(data.updatedAt),
  };
};

const toCheckout = (snapshot: { id: string; data: () => DocumentData }): ToolCheckoutRecord => {
  const data = snapshot.data();
  return {
    id: snapshot.id,
    toolId: String(data.toolId ?? ""),
    projectId: String(data.projectId ?? ""),
    checkedOutBy: String(data.checkedOutBy ?? ""),
    checkedOutAt: toDate(data.checkedOutAt),
    expectedReturnDate: typeof data.expectedReturnDate === "string" ? data.expectedReturnDate : null,
    returnedAt: toDate(data.returnedAt),
    returnedBy: typeof data.returnedBy === "string" ? data.returnedBy : null,
    conditionOnReturn: typeof data.conditionOnReturn === "string" ? data.conditionOnReturn : null,
    notes: typeof data.notes === "string" ? data.notes : null,
    createdAt: toDate(data.createdAt),
  };
};

export const listStorageMaterials = async (): Promise<StorageMaterialRecord[]> => {
  requireCurrentUser();
  const snapshots = await getDocs(materialsCollection);
  return snapshots.docs.map(toMaterial).sort((a, b) => a.name.localeCompare(b.name));
};

export const createStorageMaterial = async (input: StorageMaterialInput) => {
  await requireManager();
  const user = requireCurrentUser();
  const quantity = input.quantity ?? 0;
  const minStockLevel = input.minStockLevel ?? 0;
  assertNonNegative(quantity, "Quantity");
  assertNonNegative(minStockLevel, "Minimum stock level");
  const reference = await addDoc(materialsCollection, {
    name: requireText(input.name, "Material name"),
    category: requireText(input.category, "Material category"),
    section: input.section?.trim() || null,
    quantity,
    unit: requireText(input.unit ?? "units", "Unit"),
    minStockLevel,
    notes: input.notes?.trim() || null,
    photoUrl: input.photoUrl?.trim() || null,
    createdBy: user.uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  const created = await getDoc(reference);
  if (!created.exists()) throw new Error("Material was not created");
  return toMaterial(created);
};

export const updateStorageMaterial = async (id: string, input: StorageMaterialInput) => {
  await requireManager();
  const materialId = requireText(id, "Material id");
  const quantity = input.quantity ?? 0;
  const minStockLevel = input.minStockLevel ?? 0;
  assertNonNegative(quantity, "Quantity");
  assertNonNegative(minStockLevel, "Minimum stock level");
  const reference = doc(materialsCollection, materialId);
  await updateDoc(reference, {
    name: requireText(input.name, "Material name"),
    category: requireText(input.category, "Material category"),
    section: input.section?.trim() || null,
    quantity,
    unit: requireText(input.unit ?? "units", "Unit"),
    minStockLevel,
    notes: input.notes?.trim() || null,
    photoUrl: input.photoUrl?.trim() || null,
    updatedAt: serverTimestamp(),
  });
  const updated = await getDoc(reference);
  if (!updated.exists()) throw new Error("Material was not found after update");
  return toMaterial(updated);
};

export const listStorageTools = async (availableOnly = false): Promise<StorageToolRecord[]> => {
  requireCurrentUser();
  const snapshots = availableOnly
    ? await getDocs(query(toolsCollection, where("status", "==", "available")))
    : await getDocs(toolsCollection);
  return snapshots.docs.map(toTool).sort((a, b) => a.name.localeCompare(b.name));
};

export const createStorageTool = async (input: StorageToolInput) => {
  await requireManager();
  const user = requireCurrentUser();
  const status = input.status ?? "available";
  if (status === "checked_out") throw new Error("A new tool cannot start checked out");
  const reference = await addDoc(toolsCollection, {
    name: requireText(input.name, "Tool name"),
    category: requireText(input.category, "Tool category"),
    section: input.section?.trim() || null,
    serialNumber: input.serialNumber?.trim() || null,
    condition: input.condition?.trim() || "good",
    status,
    notes: input.notes?.trim() || null,
    createdBy: user.uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  const created = await getDoc(reference);
  if (!created.exists()) throw new Error("Tool was not created");
  return toTool(created);
};

export const updateStorageTool = async (id: string, input: StorageToolInput) => {
  await requireManager();
  const reference = doc(toolsCollection, requireText(id, "Tool id"));
  await updateDoc(reference, {
    name: requireText(input.name, "Tool name"),
    category: requireText(input.category, "Tool category"),
    section: input.section?.trim() || null,
    serialNumber: input.serialNumber?.trim() || null,
    condition: input.condition?.trim() || "good",
    status: input.status ?? "available",
    notes: input.notes?.trim() || null,
    updatedAt: serverTimestamp(),
  });
  const updated = await getDoc(reference);
  if (!updated.exists()) throw new Error("Tool was not found after update");
  return toTool(updated);
};

export const createToolRequest = async (input: {
  toolId: string;
  projectId: string;
  notes?: string | null;
}) => {
  const user = requireCurrentUser();
  if ((await getCurrentRole()) !== "builder") throw new Error("Only builders can request tools");
  const toolId = requireText(input.toolId, "Tool id");
  const projectId = requireText(input.projectId, "Project id");
  const tool = await getDoc(doc(toolsCollection, toolId));
  if (!tool.exists() || tool.data().status !== "available") throw new Error("Tool is not available");
  const reference = await addDoc(requestsCollection, {
    toolId, projectId, requestedBy: user.uid, requestedAt: serverTimestamp(), status: "pending",
    notes: input.notes?.trim() || null, approvedBy: null, approvedAt: null, pickedUpBy: null,
    pickedUpAt: null, deliveredBy: null, deliveredAt: null, returnedBy: null, returnedAt: null,
    rejectionReason: null, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
  });
  const created = await getDoc(reference);
  if (!created.exists()) throw new Error("Tool request was not created");
  return toRequest(created);
};

export const listToolRequests = async (statuses?: ToolRequestStatus[]) => {
  const user = requireCurrentUser();
  const role = await getCurrentRole();
  const constraints = role === "manager"
    ? statuses?.length ? [where("status", "in", statuses)] : []
    : [where("requestedBy", "==", user.uid)];
  const snapshots = await getDocs(query(requestsCollection, ...constraints));
  return snapshots.docs.map(toRequest).sort((a, b) =>
    (b.requestedAt?.getTime() ?? 0) - (a.requestedAt?.getTime() ?? 0));
};

export const updateToolRequest = async (input: {
  requestId: string;
  status: ToolRequestStatus;
  rejectionReason?: string | null;
}) => {
  const user = requireCurrentUser();
  if ((await getCurrentRole()) !== "manager") throw new Error("Manager access is required");
  const reference = doc(requestsCollection, requireText(input.requestId, "Request id"));
  const current = await getDoc(reference);
  if (!current.exists()) throw new Error("Tool request was not found");
  const currentStatus = current.data().status as ToolRequestStatus;
  const transitions: Record<ToolRequestStatus, ToolRequestStatus[]> = {
    pending: ["approved", "rejected"], approved: ["picked_up", "rejected"],
    picked_up: ["delivered", "returned"], delivered: ["returned"], rejected: [], returned: [],
  };
  if (!transitions[currentStatus]?.includes(input.status)) throw new Error("Tool request status transition is invalid");
  const now = serverTimestamp();
  const update: Record<string, unknown> = { status: input.status, updatedAt: now };
  if (input.status === "approved") { update.approvedBy = user.uid; update.approvedAt = now; }
  if (input.status === "picked_up") { update.pickedUpBy = user.uid; update.pickedUpAt = now; }
  if (input.status === "delivered") { update.deliveredBy = user.uid; update.deliveredAt = now; }
  if (input.status === "returned") { update.returnedBy = user.uid; update.returnedAt = now; }
  if (input.status === "rejected") update.rejectionReason = input.rejectionReason?.trim() || null;
  await updateDoc(reference, update);
  const updated = await getDoc(reference);
  if (!updated.exists()) throw new Error("Tool request was not found after update");
  return toRequest(updated);
};

export const checkoutTool = async (input: {
  toolId: string;
  projectId: string;
  expectedReturnDate?: string | null;
  notes?: string | null;
}) => {
  const user = requireCurrentUser();
  const role = await getCurrentRole();
  if (role !== "builder" && role !== "manager") throw new Error("A valid role is required");
  const toolId = requireText(input.toolId, "Tool id");
  const projectId = requireText(input.projectId, "Project id");
  const checkout = await runTransaction(firebaseDb, async (transaction) => {
    const toolReference = doc(toolsCollection, toolId);
    const tool = await transaction.get(toolReference);
    if (!tool.exists() || tool.data().status !== "available") throw new Error("Tool is not available");
    const checkoutReference = doc(checkoutsCollection);
    transaction.set(toolReference, { status: "checked_out", updatedAt: serverTimestamp() }, { merge: true });
    transaction.set(checkoutReference, {
      toolId, projectId, checkedOutBy: user.uid, checkedOutAt: serverTimestamp(),
      expectedReturnDate: input.expectedReturnDate?.trim() || null, returnedAt: null,
      returnedBy: null, conditionOnReturn: null, notes: input.notes?.trim() || null,
      createdAt: serverTimestamp(),
    });
    return checkoutReference;
  });
  const created = await getDoc(checkout);
  if (!created.exists()) throw new Error("Tool checkout was not created");
  return toCheckout(created);
};

export const listToolCheckouts = async (activeOnly = false) => {
  const user = requireCurrentUser();
  const role = await getCurrentRole();
  const constraints = role === "manager"
    ? activeOnly ? [where("returnedAt", "==", null)] : []
    : [where("checkedOutBy", "==", user.uid)];
  const snapshots = await getDocs(query(checkoutsCollection, ...constraints));
  return snapshots.docs.map(toCheckout).sort((a, b) =>
    (b.checkedOutAt?.getTime() ?? 0) - (a.checkedOutAt?.getTime() ?? 0));
};

export const returnTool = async (input: {
  checkoutId: string;
  conditionOnReturn?: string | null;
  notes?: string | null;
}) => {
  const user = requireCurrentUser();
  const role = await getCurrentRole();
  const checkoutReference = doc(checkoutsCollection, requireText(input.checkoutId, "Checkout id"));
  await runTransaction(firebaseDb, async (transaction) => {
    const checkout = await transaction.get(checkoutReference);
    if (!checkout.exists()) throw new Error("Tool checkout was not found");
    const data = checkout.data();
    if (data.returnedAt) throw new Error("Tool checkout was already returned");
    if (role !== "manager" && data.checkedOutBy !== user.uid) throw new Error("You can only return your own checkout");
    const toolReference = doc(toolsCollection, String(data.toolId));
    const tool = await transaction.get(toolReference);
    if (!tool.exists()) throw new Error("Tool was not found");
    transaction.update(checkoutReference, {
      returnedAt: serverTimestamp(), returnedBy: user.uid,
      conditionOnReturn: input.conditionOnReturn?.trim() || null,
      notes: input.notes?.trim() || data.notes || null,
    });
    transaction.update(toolReference, { status: "available", updatedAt: serverTimestamp() });
  });
  const updated = await getDoc(checkoutReference);
  if (!updated.exists()) throw new Error("Tool checkout was not found after return");
  return toCheckout(updated);
};

export const transferMaterial = async (input: {
  materialId: string;
  projectId: string;
  quantity: number;
  notes?: string | null;
}) => {
  await requireManager();
  const user = requireCurrentUser();
  const quantity = input.quantity;
  assertNonNegative(quantity, "Transfer quantity");
  if (quantity <= 0) throw new Error("Transfer quantity must be greater than zero");
  const materialId = requireText(input.materialId, "Material id");
  const projectId = requireText(input.projectId, "Project id");
  await runTransaction(firebaseDb, async (transaction) => {
    const materialReference = doc(materialsCollection, materialId);
    const material = await transaction.get(materialReference);
    if (!material.exists()) throw new Error("Material was not found");
    const currentQuantity = Number(material.data().quantity ?? 0);
    if (currentQuantity < quantity) throw new Error("Insufficient material quantity");
    const transferReference = doc(transfersCollection);
    transaction.update(materialReference, { quantity: currentQuantity - quantity, updatedAt: serverTimestamp() });
    transaction.set(transferReference, {
      materialId, projectId, quantity, transferredBy: user.uid,
      transferredAt: serverTimestamp(), notes: input.notes?.trim() || null,
    });
  });
};
