import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type DocumentData,
  type Timestamp,
} from "firebase/firestore";
import { getCurrentRole } from "@/lib/firebase/auth";
import { firebaseAuth, firebaseDb } from "@/lib/firebase/client";
import { isManagementRole } from "@/lib/firebase/types";
import {
  buildPrivateStoragePath,
  deletePrivateFile,
  uploadPrivateFile,
} from "@/lib/firebase/storage";

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
  requestedByName: string | null;
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
  checkoutId: string | null;
  createdAt: Date | null;
  updatedAt: Date | null;
}

export interface ToolCheckoutRecord {
  id: string;
  toolId: string;
  projectId: string;
  checkedOutBy: string;
  checkedOutByName: string | null;
  issuedBy: string;
  toolRequestId: string | null;
  checkedOutAt: Date | null;
  expectedReturnDate: string | null;
  returnedAt: Date | null;
  returnedBy: string | null;
  conditionOnReturn: string | null;
  notes: string | null;
  createdAt: Date | null;
}

export interface MaterialUsageRecord {
  id: string;
  projectId: string;
  projectName: string | null;
  materialId: string;
  materialName: string | null;
  materialUnit: string | null;
  jobId: string | null;
  quantityUsed: number;
  usedBy: string;
  usedByName: string | null;
  date: string;
  notes: string | null;
  createdAt: Date | null;
}

export interface MaterialTransferRecord {
  id: string;
  materialId: string;
  materialName: string | null;
  materialUnit: string | null;
  projectId: string;
  projectName: string | null;
  quantity: number;
  transferredBy: string;
  transferredByName: string | null;
  transferredAt: Date | null;
  notes: string | null;
}

export interface MaterialDeliveryItemRecord {
  id: string;
  requestId: string;
  materialId: string;
  quantity: number;
  createdAt: Date | null;
}

export interface MaterialDeliveryRequestRecord {
  id: string;
  projectId: string;
  userId: string;
  requestedByName: string | null;
  status: "pending" | "in_progress" | "delivered" | "rejected";
  notes: string | null;
  createdAt: Date | null;
  resolvedAt: Date | null;
  resolvedBy: string | null;
  items: MaterialDeliveryItemRecord[];
}

export interface RubbishRequestRecord {
  id: string;
  userId: string;
  requestedByName: string | null;
  projectId: string;
  photoPaths: string[];
  description: string | null;
  status: "pending" | "resolved";
  createdAt: Date | null;
  resolvedAt: Date | null;
  resolvedBy: string | null;
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
const usageCollection = collection(firebaseDb, "materialUsage");
const projectsCollection = collection(firebaseDb, "projects");
const jobsCollection = collection(firebaseDb, "jobs");
const deliveryRequestsCollection = collection(firebaseDb, "materialDeliveryRequests");
const deliveryItemsCollection = collection(firebaseDb, "materialDeliveryItems");
const rubbishCollection = collection(firebaseDb, "rubbishCollectionRequests");

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
  if (!isManagementRole(await getCurrentRole())) throw new Error("Manager access is required");
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
    requestedByName: typeof data.requestedByName === "string" ? data.requestedByName : null,
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
    checkoutId: typeof data.checkoutId === "string" ? data.checkoutId : null,
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
    checkedOutByName: typeof data.checkedOutByName === "string" ? data.checkedOutByName : null,
    issuedBy: String(data.issuedBy ?? ""),
    toolRequestId: typeof data.toolRequestId === "string" ? data.toolRequestId : null,
    checkedOutAt: toDate(data.checkedOutAt),
    expectedReturnDate: typeof data.expectedReturnDate === "string" ? data.expectedReturnDate : null,
    returnedAt: toDate(data.returnedAt),
    returnedBy: typeof data.returnedBy === "string" ? data.returnedBy : null,
    conditionOnReturn: typeof data.conditionOnReturn === "string" ? data.conditionOnReturn : null,
    notes: typeof data.notes === "string" ? data.notes : null,
    createdAt: toDate(data.createdAt),
  };
};

const toUsage = (snapshot: { id: string; data: () => DocumentData }): MaterialUsageRecord => {
  const data = snapshot.data();
  return {
    id: snapshot.id,
    projectId: String(data.projectId ?? ""),
    projectName: typeof data.projectName === "string" ? data.projectName : null,
    materialId: String(data.materialId ?? ""),
    materialName: typeof data.materialName === "string" ? data.materialName : null,
    materialUnit: typeof data.materialUnit === "string" ? data.materialUnit : null,
    jobId: typeof data.jobId === "string" ? data.jobId : null,
    quantityUsed: Number(data.quantityUsed ?? 0),
    usedBy: String(data.usedBy ?? ""),
    usedByName: typeof data.usedByName === "string" ? data.usedByName : null,
    date: String(data.date ?? ""),
    notes: typeof data.notes === "string" ? data.notes : null,
    createdAt: toDate(data.createdAt),
  };
};

const toTransfer = (snapshot: { id: string; data: () => DocumentData }): MaterialTransferRecord => {
  const data = snapshot.data();
  return {
    id: snapshot.id,
    materialId: String(data.materialId ?? ""),
    materialName: typeof data.materialName === "string" ? data.materialName : null,
    materialUnit: typeof data.materialUnit === "string" ? data.materialUnit : null,
    projectId: String(data.projectId ?? ""),
    projectName: typeof data.projectName === "string" ? data.projectName : null,
    quantity: Number(data.quantity ?? 0),
    transferredBy: String(data.transferredBy ?? ""),
    transferredByName: typeof data.transferredByName === "string" ? data.transferredByName : null,
    transferredAt: toDate(data.transferredAt),
    notes: typeof data.notes === "string" ? data.notes : null,
  };
};

const toDeliveryItem = (snapshot: { id: string; data: () => DocumentData }): MaterialDeliveryItemRecord => {
  const data = snapshot.data();
  return {
    id: snapshot.id,
    requestId: String(data.requestId ?? ""),
    materialId: String(data.materialId ?? ""),
    quantity: Number(data.quantity ?? 0),
    createdAt: toDate(data.createdAt),
  };
};

const toDeliveryRequest = (
  snapshot: { id: string; data: () => DocumentData },
  items: MaterialDeliveryItemRecord[] = [],
): MaterialDeliveryRequestRecord => {
  const data = snapshot.data();
  const statuses: MaterialDeliveryRequestRecord["status"][] = [
    "pending",
    "in_progress",
    "delivered",
    "rejected",
  ];
  return {
    id: snapshot.id,
    projectId: String(data.projectId ?? ""),
    userId: String(data.userId ?? ""),
    requestedByName: typeof data.requestedByName === "string" ? data.requestedByName : null,
    status: statuses.includes(data.status) ? data.status : "pending",
    notes: typeof data.notes === "string" ? data.notes : null,
    createdAt: toDate(data.createdAt),
    resolvedAt: toDate(data.resolvedAt),
    resolvedBy: typeof data.resolvedBy === "string" ? data.resolvedBy : null,
    items,
  };
};

const toRubbish = (snapshot: { id: string; data: () => DocumentData }): RubbishRequestRecord => {
  const data = snapshot.data();
  const photoPaths = Array.isArray(data.photoPaths)
    ? data.photoPaths.filter((path: unknown): path is string => typeof path === "string")
    : [];
  return {
    id: snapshot.id,
    userId: String(data.userId ?? ""),
    requestedByName: typeof data.requestedByName === "string" ? data.requestedByName : null,
    projectId: String(data.projectId ?? ""),
    photoPaths,
    description: typeof data.description === "string" ? data.description : null,
    status: data.status === "resolved" ? "resolved" : "pending",
    createdAt: toDate(data.createdAt),
    resolvedAt: toDate(data.resolvedAt),
    resolvedBy: typeof data.resolvedBy === "string" ? data.resolvedBy : null,
  };
};

export const listStorageMaterials = async (): Promise<StorageMaterialRecord[]> => {
  requireCurrentUser();
  const snapshots = await getDocs(materialsCollection);
  return snapshots.docs.map(toMaterial).sort((a, b) => a.name.localeCompare(b.name));
};

export const subscribeToStorageMaterials = (
  onChange: (materials: StorageMaterialRecord[]) => void,
  onError: (error: Error) => void,
): (() => void) => {
  requireCurrentUser();
  return onSnapshot(
    materialsCollection,
    (snapshot) => {
      onChange(snapshot.docs.map(toMaterial).sort((a, b) => a.name.localeCompare(b.name)));
    },
    (error) => onError(error instanceof Error ? error : new Error("Unable to load materials")),
  );
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

export const deleteStorageMaterial = async (id: string): Promise<void> => {
  await requireManager();
  await deleteDoc(doc(materialsCollection, requireText(id, "Material id")));
};

export const listStorageTools = async (availableOnly = false): Promise<StorageToolRecord[]> => {
  requireCurrentUser();
  const snapshots = availableOnly
    ? await getDocs(query(toolsCollection, where("status", "==", "available")))
    : await getDocs(toolsCollection);
  return snapshots.docs.map(toTool).sort((a, b) => a.name.localeCompare(b.name));
};

export const subscribeToStorageTools = (
  onChange: (tools: StorageToolRecord[]) => void,
  onError: (error: Error) => void,
  availableOnly = false,
): (() => void) => {
  requireCurrentUser();
  const source = availableOnly
    ? query(toolsCollection, where("status", "==", "available"))
    : toolsCollection;
  return onSnapshot(
    source,
    (snapshot) => {
      onChange(snapshot.docs.map(toTool).sort((a, b) => a.name.localeCompare(b.name)));
    },
    (error) => onError(error instanceof Error ? error : new Error("Unable to load tools")),
  );
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

export const deleteStorageTool = async (id: string): Promise<void> => {
  await requireManager();
  const reference = doc(toolsCollection, requireText(id, "Tool id"));
  const current = await getDoc(reference);
  if (current.exists() && current.data().status === "checked_out") {
    throw new Error("A checked out tool cannot be deleted");
  }
  await deleteDoc(reference);
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
    requestedByName: user.displayName?.trim() || null,
    notes: input.notes?.trim() || null, approvedBy: null, approvedAt: null, pickedUpBy: null,
    pickedUpAt: null, deliveredBy: null, deliveredAt: null, returnedBy: null, returnedAt: null,
    rejectionReason: null, checkoutId: null, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
  });
  const created = await getDoc(reference);
  if (!created.exists()) throw new Error("Tool request was not created");
  return toRequest(created);
};

export const listToolRequests = async (statuses?: ToolRequestStatus[]) => {
  const user = requireCurrentUser();
  const role = await getCurrentRole();
  const constraints = isManagementRole(role)
    ? statuses?.length ? [where("status", "in", statuses)] : []
    : [where("requestedBy", "==", user.uid)];
  const snapshots = await getDocs(query(requestsCollection, ...constraints));
  return snapshots.docs.map(toRequest).sort((a, b) =>
    (b.requestedAt?.getTime() ?? 0) - (a.requestedAt?.getTime() ?? 0));
};

export const subscribeToToolRequests = async (
  onChange: (requests: ToolRequestRecord[]) => void,
  onError: (error: Error) => void,
  options: { scope: "mine" | "all"; statuses?: ToolRequestStatus[] },
): Promise<() => void> => {
  const user = requireCurrentUser();
  const statuses = [...new Set(options.statuses ?? [])];
  if (statuses.length > 10) throw new Error("Too many request statuses");
  if (options.scope === "all") await requireManager();
  const source = options.scope === "mine"
    ? query(requestsCollection, where("requestedBy", "==", user.uid))
    : statuses.length > 0
      ? query(requestsCollection, where("status", "in", statuses))
      : requestsCollection;

  return onSnapshot(
    source,
    (snapshot) => {
      const records = snapshot.docs
        .map(toRequest)
        .filter((request) => options.scope === "all" || statuses.length === 0 || statuses.includes(request.status))
        .sort((a, b) => (b.requestedAt?.getTime() ?? 0) - (a.requestedAt?.getTime() ?? 0));
      onChange(records);
    },
    (error) => onError(error instanceof Error ? error : new Error("Unable to load tool requests")),
  );
};

export const updateToolRequest = async (input: {
  requestId: string;
  status: ToolRequestStatus;
  rejectionReason?: string | null;
}) => {
  const user = requireCurrentUser();
  if (!isManagementRole(await getCurrentRole())) throw new Error("Manager access is required");
  const reference = doc(requestsCollection, requireText(input.requestId, "Request id"));
  const current = await getDoc(reference);
  if (!current.exists()) throw new Error("Tool request was not found");
  const currentStatus = current.data().status as ToolRequestStatus;
  const transitions: Record<ToolRequestStatus, ToolRequestStatus[]> = {
    pending: ["approved", "rejected"], approved: ["rejected"],
    picked_up: ["delivered"], delivered: [], rejected: [], returned: [],
  };
  if (!transitions[currentStatus]?.includes(input.status)) throw new Error("Tool request status transition is invalid");
  if (input.status === "delivered" && typeof current.data().checkoutId !== "string") {
    throw new Error("The tool request has no checkout");
  }
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

export const checkOutToolRequest = async (input: {
  requestId: string;
  expectedReturnDate?: string | null;
  notes?: string | null;
}) => {
  await requireManager();
  const manager = requireCurrentUser();
  const requestReference = doc(requestsCollection, requireText(input.requestId, "Request id"));
  const checkoutReference = doc(checkoutsCollection);

  await runTransaction(firebaseDb, async (transaction) => {
    const request = await transaction.get(requestReference);
    if (!request.exists()) throw new Error("Tool request was not found");
    const requestData = request.data();
    if (requestData.status !== "approved") throw new Error("Only an approved request can be checked out");

    const toolReference = doc(toolsCollection, requireText(String(requestData.toolId ?? ""), "Tool id"));
    const tool = await transaction.get(toolReference);
    if (!tool.exists() || tool.data().status !== "available") throw new Error("Tool is not available");

    const now = serverTimestamp();
    transaction.update(requestReference, {
      status: "picked_up",
      pickedUpBy: manager.uid,
      pickedUpAt: now,
      checkoutId: checkoutReference.id,
      updatedAt: now,
    });
    transaction.update(toolReference, { status: "checked_out", updatedAt: now });
    transaction.set(checkoutReference, {
      toolId: requestData.toolId,
      projectId: requestData.projectId,
      checkedOutBy: requestData.requestedBy,
      checkedOutByName: typeof requestData.requestedByName === "string" ? requestData.requestedByName : null,
      issuedBy: manager.uid,
      toolRequestId: requestReference.id,
      checkedOutAt: now,
      expectedReturnDate: input.expectedReturnDate?.trim() || null,
      returnedAt: null,
      returnedBy: null,
      conditionOnReturn: null,
      notes: input.notes?.trim() || requestData.notes || null,
      createdAt: now,
    });
  });

  const [request, checkout] = await Promise.all([
    getDoc(requestReference),
    getDoc(checkoutReference),
  ]);
  if (!request.exists() || !checkout.exists()) throw new Error("Tool checkout was not created");
  return { request: toRequest(request), checkout: toCheckout(checkout) };
};

export const checkoutTool = async (input: {
  toolId: string;
  projectId: string;
  expectedReturnDate?: string | null;
  notes?: string | null;
}) => {
  await requireManager();
  const user = requireCurrentUser();
  const toolId = requireText(input.toolId, "Tool id");
  const projectId = requireText(input.projectId, "Project id");
  const checkout = await runTransaction(firebaseDb, async (transaction) => {
    const toolReference = doc(toolsCollection, toolId);
    const tool = await transaction.get(toolReference);
    if (!tool.exists() || tool.data().status !== "available") throw new Error("Tool is not available");
    const checkoutReference = doc(checkoutsCollection);
    transaction.set(toolReference, { status: "checked_out", updatedAt: serverTimestamp() }, { merge: true });
    transaction.set(checkoutReference, {
      toolId, projectId, checkedOutBy: user.uid, checkedOutByName: user.displayName?.trim() || null,
      issuedBy: user.uid, toolRequestId: null, checkedOutAt: serverTimestamp(),
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
  const constraints = isManagementRole(role)
    ? activeOnly ? [where("returnedAt", "==", null)] : []
    : [where("checkedOutBy", "==", user.uid)];
  const snapshots = await getDocs(query(checkoutsCollection, ...constraints));
  return snapshots.docs.map(toCheckout).sort((a, b) =>
    (b.checkedOutAt?.getTime() ?? 0) - (a.checkedOutAt?.getTime() ?? 0));
};

export const subscribeToToolCheckouts = async (
  onChange: (checkouts: ToolCheckoutRecord[]) => void,
  onError: (error: Error) => void,
): Promise<() => void> => {
  await requireManager();
  return onSnapshot(
    checkoutsCollection,
    (snapshot) => {
      onChange(snapshot.docs.map(toCheckout).sort((a, b) =>
        (b.checkedOutAt?.getTime() ?? 0) - (a.checkedOutAt?.getTime() ?? 0)));
    },
    (error) => onError(error instanceof Error ? error : new Error("Unable to load tool checkouts")),
  );
};

export const returnTool = async (input: {
  checkoutId: string;
  conditionOnReturn?: string | null;
  notes?: string | null;
}) => {
  await requireManager();
  const user = requireCurrentUser();
  const checkoutReference = doc(checkoutsCollection, requireText(input.checkoutId, "Checkout id"));
  await runTransaction(firebaseDb, async (transaction) => {
    const checkout = await transaction.get(checkoutReference);
    if (!checkout.exists()) throw new Error("Tool checkout was not found");
    const data = checkout.data();
    if (data.returnedAt) throw new Error("Tool checkout was already returned");
    const toolReference = doc(toolsCollection, String(data.toolId));
    const tool = await transaction.get(toolReference);
    if (!tool.exists()) throw new Error("Tool was not found");
    const requestReference = typeof data.toolRequestId === "string"
      ? doc(requestsCollection, data.toolRequestId)
      : null;
    const request = requestReference ? await transaction.get(requestReference) : null;
    if (request && (!request.exists() || !["picked_up", "delivered"].includes(request.data().status))) {
      throw new Error("Linked tool request cannot be returned");
    }
    const now = serverTimestamp();
    transaction.update(checkoutReference, {
      returnedAt: now, returnedBy: user.uid,
      conditionOnReturn: input.conditionOnReturn?.trim() || null,
      notes: input.notes?.trim() || data.notes || null,
    });
    transaction.update(toolReference, { status: "available", updatedAt: now });
    if (requestReference) {
      transaction.update(requestReference, {
        status: "returned",
        returnedBy: user.uid,
        returnedAt: now,
        updatedAt: now,
      });
    }
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
  if (quantity <= 0 || quantity > 1_000_000) {
    throw new Error("Transfer quantity must be between 0 and 1,000,000");
  }
  const materialId = requireText(input.materialId, "Material id");
  const projectId = requireText(input.projectId, "Project id");
  const notes = input.notes?.trim() || null;
  if (notes && notes.length > 1_000) throw new Error("Transfer notes are too long");
  const transferReference = doc(transfersCollection);
  await runTransaction(firebaseDb, async (transaction) => {
    const materialReference = doc(materialsCollection, materialId);
    const projectReference = doc(projectsCollection, projectId);
    const [material, project] = await Promise.all([
      transaction.get(materialReference),
      transaction.get(projectReference),
    ]);
    if (!material.exists()) throw new Error("Material was not found");
    if (!project.exists()) throw new Error("Project was not found");
    const currentQuantity = Number(material.data().quantity ?? 0);
    if (currentQuantity < quantity) throw new Error("Insufficient material quantity");
    const now = serverTimestamp();
    transaction.update(materialReference, { quantity: currentQuantity - quantity, updatedAt: now });
    transaction.set(transferReference, {
      materialId,
      materialName: String(material.data().name ?? ""),
      materialUnit: String(material.data().unit ?? "units"),
      projectId,
      projectName: String(project.data().name ?? ""),
      quantity,
      transferredBy: user.uid,
      transferredByName: user.displayName?.trim() || null,
      transferredAt: now, notes,
    });
  });
  const created = await getDoc(transferReference);
  if (!created.exists()) throw new Error("Material transfer was not recorded");
  return toTransfer(created);
};

export const recordMaterialUsage = async (input: {
  projectId: string;
  materialId: string;
  quantityUsed: number;
  date: string;
  jobId?: string | null;
  notes?: string | null;
}) => {
  await requireManager();
  const user = requireCurrentUser();
  assertNonNegative(input.quantityUsed, "Usage quantity");
  if (input.quantityUsed <= 0 || input.quantityUsed > 1_000_000) {
    throw new Error("Usage quantity must be between 0 and 1,000,000");
  }
  const projectId = requireText(input.projectId, "Project id");
  const materialId = requireText(input.materialId, "Material id");
  const date = requireText(input.date, "Usage date");
  const parsedDate = new Date(`${date}T00:00:00Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(date)
    || Number.isNaN(parsedDate.getTime())
    || parsedDate.toISOString().slice(0, 10) !== date
  ) {
    throw new Error("Usage date must use YYYY-MM-DD format");
  }
  const notes = input.notes?.trim() || null;
  if (notes && notes.length > 1_000) throw new Error("Usage notes are too long");
  const jobId = input.jobId?.trim() || null;
  const usage = await runTransaction(firebaseDb, async (transaction) => {
    const materialReference = doc(materialsCollection, materialId);
    const projectReference = doc(projectsCollection, projectId);
    const jobReference = jobId ? doc(jobsCollection, jobId) : null;
    const [material, project, job] = await Promise.all([
      transaction.get(materialReference),
      transaction.get(projectReference),
      jobReference ? transaction.get(jobReference) : Promise.resolve(null),
    ]);
    if (!material.exists()) throw new Error("Material was not found");
    if (!project.exists()) throw new Error("Project was not found");
    if (jobReference && (!job?.exists() || job.data().projectId !== projectId)) {
      throw new Error("Job does not belong to the selected project");
    }
    const currentQuantity = Number(material.data().quantity ?? 0);
    if (currentQuantity < input.quantityUsed) throw new Error("Insufficient material quantity");
    const usageReference = doc(usageCollection);
    const now = serverTimestamp();
    transaction.update(materialReference, {
      quantity: currentQuantity - input.quantityUsed,
      updatedAt: now,
    });
    transaction.set(usageReference, {
      projectId,
      projectName: String(project.data().name ?? ""),
      materialId,
      materialName: String(material.data().name ?? ""),
      materialUnit: String(material.data().unit ?? "units"),
      quantityUsed: input.quantityUsed,
      usedBy: user.uid,
      date,
      usedByName: user.displayName?.trim() || null,
      jobId, notes, createdAt: now,
    });
    return usageReference;
  });
  const created = await getDoc(usage);
  if (!created.exists()) throw new Error("Material usage was not recorded");
  return toUsage(created);
};

export const listMaterialUsage = async (projectId?: string) => {
  const user = requireCurrentUser();
  const role = await getCurrentRole();
  const constraints = isManagementRole(role)
    ? projectId?.trim() ? [where("projectId", "==", projectId.trim())] : []
    : [where("usedBy", "==", user.uid)];
  const snapshots = await getDocs(query(usageCollection, ...constraints));
  return snapshots.docs.map(toUsage).sort((a, b) =>
    (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0));
};

export const subscribeToMaterialTransfers = async (
  onChange: (transfers: MaterialTransferRecord[]) => void,
  onError: (error: Error) => void,
): Promise<() => void> => {
  await requireManager();
  return onSnapshot(
    transfersCollection,
    (snapshot) => {
      onChange(snapshot.docs.map(toTransfer).sort((a, b) =>
        (b.transferredAt?.getTime() ?? 0) - (a.transferredAt?.getTime() ?? 0)));
    },
    (error) => onError(error instanceof Error ? error : new Error("Unable to load material transfers")),
  );
};

export const subscribeToMaterialUsage = async (
  onChange: (usage: MaterialUsageRecord[]) => void,
  onError: (error: Error) => void,
): Promise<() => void> => {
  await requireManager();
  return onSnapshot(
    usageCollection,
    (snapshot) => {
      onChange(snapshot.docs.map(toUsage).sort((a, b) =>
        (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0)));
    },
    (error) => onError(error instanceof Error ? error : new Error("Unable to load material usage")),
  );
};

export const createMaterialDeliveryRequest = async (input: {
  projectId: string;
  notes?: string | null;
  items: Array<{ materialId: string; quantity: number }>;
}) => {
  const user = requireCurrentUser();
  if ((await getCurrentRole()) !== "builder") throw new Error("Only builders can request deliveries");
  if (!input.items.length) throw new Error("At least one delivery item is required");
  if (input.items.length > 25) throw new Error("A delivery request can contain at most 25 items");
  const projectId = requireText(input.projectId, "Project id");
  const notes = input.notes?.trim() || null;
  if (notes && notes.length > 1_000) throw new Error("Delivery notes are too long");
  const items = input.items.map((item) => {
    const materialId = requireText(item.materialId, "Material id");
    assertNonNegative(item.quantity, "Delivery quantity");
    if (item.quantity <= 0 || item.quantity > 1_000_000) {
      throw new Error("Delivery quantity must be between 0 and 1,000,000");
    }
    return { materialId, quantity: item.quantity };
  });
  if (new Set(items.map((item) => item.materialId)).size !== items.length) {
    throw new Error("A material can only appear once in a delivery request");
  }
  const requestReference = doc(deliveryRequestsCollection);
  const batch = writeBatch(firebaseDb);
  batch.set(requestReference, {
    projectId,
    userId: user.uid,
    requestedByName: user.displayName?.trim() || null,
    status: "pending",
    notes,
    createdAt: serverTimestamp(), resolvedAt: null, resolvedBy: null,
  });
  items.forEach((item) => {
    batch.set(doc(deliveryItemsCollection), {
      requestId: requestReference.id,
      materialId: item.materialId,
      quantity: item.quantity,
      createdAt: serverTimestamp(),
    });
  });
  await batch.commit();
  return getMaterialDeliveryRequest(requestReference.id);
};

export const getMaterialDeliveryRequest = async (requestId: string) => {
  requireCurrentUser();
  const requestReference = doc(deliveryRequestsCollection, requireText(requestId, "Request id"));
  const requestSnapshot = await getDoc(requestReference);
  if (!requestSnapshot.exists()) return null;
  const itemsSnapshot = await getDocs(query(deliveryItemsCollection, where("requestId", "==", requestSnapshot.id)));
  return toDeliveryRequest(requestSnapshot, itemsSnapshot.docs.map(toDeliveryItem));
};

export const listMaterialDeliveryRequests = async () => {
  const user = requireCurrentUser();
  const role = await getCurrentRole();
  const constraints = isManagementRole(role) ? [] : [where("userId", "==", user.uid)];
  const snapshots = await getDocs(query(deliveryRequestsCollection, ...constraints));
  const requests = await Promise.all(snapshots.docs.map((snapshot) => getMaterialDeliveryRequest(snapshot.id)));
  return requests.filter((request): request is MaterialDeliveryRequestRecord => request !== null)
    .sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0));
};

export const subscribeToMaterialDeliveryRequests = async (
  onChange: (requests: MaterialDeliveryRequestRecord[]) => void,
  onError: (error: Error) => void,
): Promise<() => void> => {
  const user = requireCurrentUser();
  const role = await getCurrentRole();
  const reportError = (error: unknown) => {
    onError(error instanceof Error ? error : new Error("Unable to load delivery requests"));
  };
  const sortRequests = (requests: MaterialDeliveryRequestRecord[]) => requests.sort((a, b) =>
    (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0));

  if (isManagementRole(role)) {
    let requestRecords: MaterialDeliveryRequestRecord[] = [];
    let itemRecords: MaterialDeliveryItemRecord[] = [];
    let requestsReady = false;
    let itemsReady = false;
    const emit = () => {
      if (!requestsReady || !itemsReady) return;
      onChange(sortRequests(requestRecords.map((request) => ({
        ...request,
        items: itemRecords.filter((item) => item.requestId === request.id),
      }))));
    };
    const stopRequests = onSnapshot(deliveryRequestsCollection, (snapshot) => {
      requestRecords = snapshot.docs.map((document) => toDeliveryRequest(document));
      requestsReady = true;
      emit();
    }, reportError);
    const stopItems = onSnapshot(deliveryItemsCollection, (snapshot) => {
      itemRecords = snapshot.docs.map(toDeliveryItem);
      itemsReady = true;
      emit();
    }, reportError);
    return () => {
      stopRequests();
      stopItems();
    };
  }

  let stopped = false;
  let generation = 0;
  let stopItemListeners: Array<() => void> = [];
  const stopRequests = onSnapshot(
    query(deliveryRequestsCollection, where("userId", "==", user.uid)),
    (snapshot) => {
      generation += 1;
      const currentGeneration = generation;
      stopItemListeners.forEach((stop) => stop());
      stopItemListeners = [];
      const requestRecords = snapshot.docs.map((document) => toDeliveryRequest(document));
      if (!requestRecords.length) {
        onChange([]);
        return;
      }
      const itemsByRequest = new Map<string, MaterialDeliveryItemRecord[]>();
      let pendingInitialSnapshots = requestRecords.length;
      const emit = () => {
        if (stopped || currentGeneration !== generation || pendingInitialSnapshots > 0) return;
        onChange(sortRequests(requestRecords.map((request) => ({
          ...request,
          items: itemsByRequest.get(request.id) ?? [],
        }))));
      };
      requestRecords.forEach((request) => {
        let initialized = false;
        const stopItems = onSnapshot(
          query(deliveryItemsCollection, where("requestId", "==", request.id)),
          (itemSnapshot) => {
            itemsByRequest.set(request.id, itemSnapshot.docs.map(toDeliveryItem));
            if (!initialized) {
              initialized = true;
              pendingInitialSnapshots -= 1;
            }
            emit();
          },
          reportError,
        );
        stopItemListeners.push(stopItems);
      });
    },
    reportError,
  );
  return () => {
    stopped = true;
    stopRequests();
    stopItemListeners.forEach((stop) => stop());
  };
};

export const updateMaterialDeliveryRequest = async (input: {
  requestId: string;
  status: MaterialDeliveryRequestRecord["status"];
}) => {
  const user = requireCurrentUser();
  if (!isManagementRole(await getCurrentRole())) throw new Error("Manager access is required");
  const reference = doc(deliveryRequestsCollection, requireText(input.requestId, "Request id"));
  const transitions: Record<MaterialDeliveryRequestRecord["status"], MaterialDeliveryRequestRecord["status"][]> = {
    pending: ["in_progress", "rejected"], in_progress: ["delivered", "rejected"],
    delivered: [], rejected: [],
  };
  await runTransaction(firebaseDb, async (transaction) => {
    const current = await transaction.get(reference);
    if (!current.exists()) throw new Error("Delivery request was not found");
    const currentStatus = current.data().status as MaterialDeliveryRequestRecord["status"];
    if (!transitions[currentStatus]?.includes(input.status)) {
      throw new Error("Delivery status transition is invalid");
    }
    const isResolved = input.status === "delivered" || input.status === "rejected";
    transaction.update(reference, {
      status: input.status,
      resolvedAt: isResolved ? serverTimestamp() : null,
      resolvedBy: isResolved ? user.uid : null,
    });
  });
  return getMaterialDeliveryRequest(reference.id);
};

export const createRubbishRequest = async (input: {
  projectId: string;
  photos: Array<{ file: Blob; fileName: string; contentType?: string }>;
  description?: string | null;
}) => {
  const user = requireCurrentUser();
  if ((await getCurrentRole()) !== "builder") throw new Error("Only builders can create rubbish requests");
  const projectId = requireText(input.projectId, "Project id");
  if (!input.photos.length) throw new Error("At least one rubbish photo is required");
  if (input.photos.length > 10) throw new Error("A rubbish request can contain at most 10 photos");
  const description = input.description?.trim() || null;
  if (description && description.length > 1_000) throw new Error("Rubbish description is too long");
  const project = await getDoc(doc(firebaseDb, "projects", projectId));
  if (!project.exists() || project.data().ownerId !== user.uid) {
    throw new Error("The selected project does not belong to this builder");
  }

  const photos = input.photos.map((photo) => {
    const contentType = photo.contentType?.trim() || photo.file.type;
    if (!(photo.file instanceof Blob) || photo.file.size <= 0) {
      throw new Error("Rubbish photos cannot be empty");
    }
    if (!contentType.startsWith("image/")) throw new Error("Rubbish evidence must be an image");
    if (photo.file.size >= 10 * 1024 * 1024) throw new Error("Each rubbish photo must be smaller than 10 MB");
    const rawExtension = photo.fileName.split(".").pop()?.toLowerCase() ?? "jpg";
    const extension = /^[a-z0-9]{1,8}$/.test(rawExtension) ? rawExtension : "jpg";
    return { file: photo.file, contentType, extension };
  });
  const reference = doc(rubbishCollection);
  const photoPaths: string[] = [];
  try {
    for (const photo of photos) {
      const photoId = doc(rubbishCollection).id;
      const path = buildPrivateStoragePath(
        "rubbish",
        user.uid,
        reference.id,
        `${photoId}.${photo.extension}`,
      );
      await uploadPrivateFile(path, photo.file, { contentType: photo.contentType });
      photoPaths.push(path);
    }
    await setDoc(reference, {
      userId: user.uid,
      requestedByName: user.displayName?.trim() || null,
      projectId,
      photoPaths,
      description,
      status: "pending",
      createdAt: serverTimestamp(),
      resolvedAt: null,
      resolvedBy: null,
    });
  } catch (error) {
    await Promise.allSettled(photoPaths.map((path) => deletePrivateFile(path)));
    throw error;
  }
  const created = await getDoc(reference);
  if (!created.exists()) throw new Error("Rubbish request was not created");
  return toRubbish(created);
};

export const listRubbishRequests = async (status?: RubbishRequestRecord["status"]) => {
  const user = requireCurrentUser();
  const role = await getCurrentRole();
  const constraints = isManagementRole(role)
    ? status ? [where("status", "==", status)] : []
    : [where("userId", "==", user.uid)];
  const snapshots = await getDocs(query(rubbishCollection, ...constraints));
  return snapshots.docs
    .map(toRubbish)
    .filter((request) => !status || request.status === status)
    .sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0));
};

export const subscribeToRubbishRequests = async (
  onChange: (requests: RubbishRequestRecord[]) => void,
  onError: (error: Error) => void,
): Promise<() => void> => {
  const user = requireCurrentUser();
  const role = await getCurrentRole();
  const source = isManagementRole(role)
    ? rubbishCollection
    : query(rubbishCollection, where("userId", "==", user.uid));
  return onSnapshot(
    source,
    (snapshot) => onChange(snapshot.docs.map(toRubbish).sort((a, b) =>
      (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0))),
    (error) => onError(error instanceof Error ? error : new Error("Unable to load rubbish requests")),
  );
};

export const resolveRubbishRequest = async (requestId: string) => {
  const user = requireCurrentUser();
  if (!isManagementRole(await getCurrentRole())) throw new Error("Manager access is required");
  const reference = doc(rubbishCollection, requireText(requestId, "Request id"));
  await runTransaction(firebaseDb, async (transaction) => {
    const current = await transaction.get(reference);
    if (!current.exists()) throw new Error("Rubbish request was not found");
    if (current.data().status !== "pending") throw new Error("Rubbish request is already resolved");
    transaction.update(reference, {
      status: "resolved",
      resolvedAt: serverTimestamp(),
      resolvedBy: user.uid,
    });
  });
  const updated = await getDoc(reference);
  if (!updated.exists()) throw new Error("Rubbish request was not found after resolution");
  return toRubbish(updated);
};
