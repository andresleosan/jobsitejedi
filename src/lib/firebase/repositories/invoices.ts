import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  where,
  type DocumentData,
  type Timestamp,
} from "firebase/firestore";
import { getCurrentRole } from "@/lib/firebase/auth";
import { firebaseAuth, firebaseDb } from "@/lib/firebase/client";
import {
  reviewInvoiceRecord,
  submitInvoiceRecord,
  type InvoiceReviewStatus,
} from "@/lib/firebase/functions";
import {
  buildPrivateStoragePath,
  createPrivateObjectUrl,
  deletePrivateFile,
  uploadPrivateFile,
} from "@/lib/firebase/storage";

export type InvoiceStatus = "submitted" | InvoiceReviewStatus;

export interface InvoiceRecord {
  id: string;
  projectId: string;
  projectName: string;
  invoiceNumber: string;
  supplierName: string;
  invoiceDate: string;
  totalAmountMinor: number;
  currency: "GBP";
  notes: string | null;
  filePath: string;
  fileName: string;
  contentType: string;
  fileSize: number;
  uploadedBy: string;
  uploadedByName: string | null;
  status: InvoiceStatus;
  reviewedBy: string | null;
  reviewedAt: Date | null;
  reviewNotes: string | null;
  createdAt: Date | null;
  updatedAt: Date | null;
}

export interface InvoiceSubmissionInput {
  projectId: string;
  invoiceNumber: string;
  supplierName: string;
  invoiceDate: string;
  totalAmountMinor: number;
  notes?: string | null;
  file: File;
}

const invoicesCollection = collection(firebaseDb, "invoices");

const requireCurrentUser = () => {
  const user = firebaseAuth.currentUser;
  if (!user) throw new Error("Authentication is required");
  return user;
};

const toDate = (value: unknown): Date | null => {
  if (value && typeof value === "object" && "toDate" in value) {
    return (value as Timestamp).toDate();
  }
  return value instanceof Date ? value : null;
};

const toInvoice = (snapshot: { id: string; data: () => DocumentData }): InvoiceRecord => {
  const data = snapshot.data();
  const status: InvoiceStatus = data.status === "approved" || data.status === "rejected"
    ? data.status
    : "submitted";
  return {
    id: snapshot.id,
    projectId: String(data.projectId ?? ""),
    projectName: String(data.projectName ?? ""),
    invoiceNumber: String(data.invoiceNumber ?? ""),
    supplierName: String(data.supplierName ?? ""),
    invoiceDate: String(data.invoiceDate ?? ""),
    totalAmountMinor: Number(data.totalAmountMinor ?? 0),
    currency: "GBP",
    notes: typeof data.notes === "string" ? data.notes : null,
    filePath: String(data.filePath ?? ""),
    fileName: String(data.fileName ?? ""),
    contentType: String(data.contentType ?? "application/octet-stream"),
    fileSize: Number(data.fileSize ?? 0),
    uploadedBy: String(data.uploadedBy ?? ""),
    uploadedByName: typeof data.uploadedByName === "string" ? data.uploadedByName : null,
    status,
    reviewedBy: typeof data.reviewedBy === "string" ? data.reviewedBy : null,
    reviewedAt: toDate(data.reviewedAt),
    reviewNotes: typeof data.reviewNotes === "string" ? data.reviewNotes : null,
    createdAt: toDate(data.createdAt),
    updatedAt: toDate(data.updatedAt),
  };
};

const safeFileName = (name: string): string => {
  const dot = name.lastIndexOf(".");
  const rawBase = dot > 0 ? name.slice(0, dot) : name;
  const rawExtension = dot > 0 ? name.slice(dot + 1) : "file";
  const base = rawBase
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "invoice";
  const extension = rawExtension.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8) || "file";
  return `${base}.${extension}`;
};

const validateSubmission = (input: InvoiceSubmissionInput) => {
  if (!input.projectId.trim()) throw new Error("Project is required");
  if (!input.invoiceNumber.trim() || input.invoiceNumber.trim().length > 80) {
    throw new Error("Invoice number is required and must be 80 characters or fewer");
  }
  if (!input.supplierName.trim() || input.supplierName.trim().length > 120) {
    throw new Error("Supplier name is required and must be 120 characters or fewer");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.invoiceDate)) throw new Error("Invoice date is required");
  if (!Number.isSafeInteger(input.totalAmountMinor) || input.totalAmountMinor <= 0) {
    throw new Error("Invoice amount must be greater than zero");
  }
  if (input.notes && input.notes.trim().length > 1_000) throw new Error("Notes must be 1,000 characters or fewer");
  if (!(input.file instanceof File) || input.file.size <= 0) throw new Error("Invoice file is required");
  if (input.file.size >= 10 * 1024 * 1024) throw new Error("Invoice file must be smaller than 10 MB");
  if (!(input.file.type === "application/pdf" || input.file.type.startsWith("image/"))) {
    throw new Error("Invoice file must be an image or PDF");
  }
};

export const parseAmountToMinor = (value: string): number => {
  const normalized = value.trim();
  const match = /^(0|[1-9]\d{0,9})(?:\.(\d{1,2}))?$/.exec(normalized);
  if (!match) throw new Error("Enter a valid amount with up to two decimal places");
  const minor = Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
  if (!Number.isSafeInteger(minor) || minor <= 0 || minor > 1_000_000_000_000) {
    throw new Error("Invoice amount must be greater than zero");
  }
  return minor;
};

export const formatInvoiceAmount = (amountMinor: number): string =>
  new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(amountMinor / 100);

export const getInvoice = async (invoiceId: string): Promise<InvoiceRecord | null> => {
  requireCurrentUser();
  const snapshot = await getDoc(doc(invoicesCollection, invoiceId));
  return snapshot.exists() ? toInvoice(snapshot) : null;
};

export const submitInvoice = async (input: InvoiceSubmissionInput): Promise<InvoiceRecord> => {
  validateSubmission(input);
  const user = requireCurrentUser();
  if ((await getCurrentRole()) !== "builder") throw new Error("Only builders can submit invoices");
  const invoiceId = doc(invoicesCollection).id;
  const fileName = safeFileName(input.file.name);
  const filePath = buildPrivateStoragePath("invoices", user.uid, invoiceId, fileName);
  await uploadPrivateFile(filePath, input.file, { contentType: input.file.type });
  try {
    await submitInvoiceRecord({
      invoiceId,
      projectId: input.projectId.trim(),
      invoiceNumber: input.invoiceNumber.trim(),
      supplierName: input.supplierName.trim(),
      invoiceDate: input.invoiceDate,
      totalAmountMinor: input.totalAmountMinor,
      currency: "GBP",
      notes: input.notes?.trim() || null,
      filePath,
      fileName: input.file.name.trim().slice(0, 180) || fileName,
    });
  } catch (error) {
    await Promise.allSettled([deletePrivateFile(filePath)]);
    throw error;
  }
  const created = await getInvoice(invoiceId);
  if (!created) throw new Error("Invoice was not created");
  return created;
};

export const listInvoices = async (): Promise<InvoiceRecord[]> => {
  const user = requireCurrentUser();
  const role = await getCurrentRole();
  const source = role === "manager"
    ? invoicesCollection
    : query(invoicesCollection, where("uploadedBy", "==", user.uid));
  const snapshot = await getDocs(source);
  return snapshot.docs.map(toInvoice).sort((left, right) =>
    (right.createdAt?.getTime() ?? 0) - (left.createdAt?.getTime() ?? 0));
};

export const subscribeToInvoices = async (
  onChange: (invoices: InvoiceRecord[]) => void,
  onError: (error: Error) => void,
): Promise<() => void> => {
  const user = requireCurrentUser();
  const role = await getCurrentRole();
  const source = role === "manager"
    ? invoicesCollection
    : query(invoicesCollection, where("uploadedBy", "==", user.uid));
  return onSnapshot(source, (snapshot) => {
    onChange(snapshot.docs.map(toInvoice).sort((left, right) =>
      (right.createdAt?.getTime() ?? 0) - (left.createdAt?.getTime() ?? 0)));
  }, (error) => onError(error instanceof Error ? error : new Error("Unable to load invoices")));
};

export const reviewInvoice = async (input: {
  invoiceId: string;
  status: InvoiceReviewStatus;
  reviewNotes?: string | null;
}): Promise<InvoiceRecord> => {
  requireCurrentUser();
  if ((await getCurrentRole()) !== "manager") throw new Error("Manager access is required");
  await reviewInvoiceRecord({
    invoiceId: input.invoiceId,
    status: input.status,
    reviewNotes: input.reviewNotes?.trim() || null,
  });
  const updated = await getInvoice(input.invoiceId);
  if (!updated) throw new Error("Invoice was not found after review");
  return updated;
};

export const createInvoiceObjectUrl = (invoice: InvoiceRecord): Promise<string> =>
  createPrivateObjectUrl(invoice.filePath, invoice.contentType);
