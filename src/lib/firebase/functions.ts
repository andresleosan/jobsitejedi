import { httpsCallable } from "firebase/functions";
import { firebaseFunctions } from "./client";
import type { AppRole } from "./types";
import type { InvitationOperations, InvitationValidation } from "./types";

const createManagerInvitationCallable = httpsCallable<
  { role: AppRole; targetEmail: string; requestKey: string },
  { code: string; role: AppRole; expiresAt: string }
>(firebaseFunctions, "createManagerInvitation");

const pendingInvitationRequestKeys = new Map<string, string>();

const createInvitationRequestKey = (): string => {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
};

const isRetryableCallableError = (error: unknown): boolean => {
  const code = typeof error === "object" && error !== null && "code" in error
    ? String(error.code)
    : "";
  return code === "functions/internal"
    || code === "functions/deadline-exceeded"
    || code === "functions/unavailable"
    || code === "functions/unknown";
};

type InvitationValidationResponse =
  | { valid: true; role: AppRole; expiresAt: string; errorMessage: null }
  | { valid: false; role: null; expiresAt: null; errorMessage: string };

const validateInvitationCodeCallable = httpsCallable<
  { code: string; targetEmail?: string },
  InvitationValidationResponse
>(firebaseFunctions, "validateInvitationCode");

const activateInvitationCallable = httpsCallable<
  { code: string; targetEmail: string; password: string; fullName: string },
  { activated: true; role: AppRole }
>(firebaseFunctions, "activateInvitation");

const consumeInvitationCallable = httpsCallable<
  { code: string },
  { role: AppRole }
>(firebaseFunctions, "consumeInvitation");

export interface SubmitInvoiceCallableInput {
  invoiceId: string;
  projectId: string;
  invoiceNumber: string;
  supplierName: string;
  invoiceDate: string;
  totalAmountMinor: number;
  currency: "GBP";
  notes: string | null;
  quarantinePath: string;
  originalFileName: string;
}

export type InvoiceReviewStatus = "approved" | "rejected";

const submitInvoiceCallable = httpsCallable<
  SubmitInvoiceCallableInput,
  { invoiceId: string; status: "submitted" | InvoiceReviewStatus }
>(firebaseFunctions, "submitInvoice");

const reviewInvoiceCallable = httpsCallable<
  { invoiceId: string; status: InvoiceReviewStatus; reviewNotes: string | null },
  { invoiceId: string; status: InvoiceReviewStatus }
>(firebaseFunctions, "reviewInvoice");

const extractJobsFromExcelCallable = httpsCallable<
  { projectId: string; filePath: string },
  { importId: string; createdJobIds: string[] }
>(firebaseFunctions, "extractJobsFromExcel");

export interface AssignableBuilder {
  id: string;
  email: string | null;
  displayName: string | null;
}

export type AccessRequestStatus = "pending" | "approving" | "approved" | "rejected";

export interface AccessRequestRecord {
  id: string;
  email: string;
  fullName: string;
  phone: string | null;
  requestedRole: AppRole | null;
  status: AccessRequestStatus;
  requestedAt: Date | null;
  reviewedAt: Date | null;
  decisionReason: string | null;
}

type AccessRequestCallableRecord = Omit<AccessRequestRecord, "requestedAt" | "reviewedAt"> & {
  requestedAt: string | null;
  reviewedAt: string | null;
};

const submitAccessRequestCallable = httpsCallable<
  { requestedRole: AppRole; fullName: string; phone?: string | null },
  { status: "pending" | "approving"; requestedRole: AppRole }
>(firebaseFunctions, "submitAccessRequest");

const getAccessRequestStatusCallable = httpsCallable<
  Record<string, never>,
  { status: AccessRequestStatus | null; requestedRole: AppRole | null }
>(firebaseFunctions, "getAccessRequestStatus");

const listAccessRequestsCallable = httpsCallable<
  Record<string, never>,
  { requests: AccessRequestCallableRecord[] }
>(firebaseFunctions, "listAccessRequests");

const reviewAccessRequestCallable = httpsCallable<
  { requestId: string; decision: "approve" | "reject"; reason?: string | null },
  AccessRequestCallableRecord
>(firebaseFunctions, "reviewAccessRequest");

const toAccessRequestRecord = (record: AccessRequestCallableRecord): AccessRequestRecord => ({
  ...record,
  requestedAt: record.requestedAt ? new Date(record.requestedAt) : null,
  reviewedAt: record.reviewedAt ? new Date(record.reviewedAt) : null,
});

export interface CreateAssignedProjectCallableInput {
  projectId: string;
  builderId: string;
  name: string;
  description: string | null;
  clientName: string;
  address: string | null;
}

const listAssignableBuildersCallable = httpsCallable<
  Record<string, never>,
  { builders: AssignableBuilder[] }
>(firebaseFunctions, "listAssignableBuilders");

const createAssignedProjectCallable = httpsCallable<
  CreateAssignedProjectCallableInput,
  { projectId: string }
>(firebaseFunctions, "createAssignedProject");

export const invitationOperations: InvitationOperations = {
  async validateInvitationCode(code: string, targetEmail?: string) {
    const result = await validateInvitationCodeCallable({
      code: code.trim().toUpperCase(),
      ...(targetEmail === undefined ? {} : { targetEmail: targetEmail.trim().toLowerCase() }),
    });
    if (!result.data.valid) {
      return {
        valid: false,
        role: null,
        expiresAt: null,
        errorMessage: result.data.errorMessage,
      };
    }
    return {
      valid: true,
      role: result.data.role,
      expiresAt: new Date(result.data.expiresAt),
      errorMessage: null,
    };
  },
  async createInvitation(input) {
    const normalizedEmail = input.targetEmail.trim().toLowerCase();
    const requestScope = `${input.role}:${normalizedEmail}`;
    const requestKey = input.requestKey
      ?? pendingInvitationRequestKeys.get(requestScope)
      ?? createInvitationRequestKey();
    pendingInvitationRequestKeys.set(requestScope, requestKey);
    try {
      const result = await createManagerInvitationCallable({
        role: input.role,
        targetEmail: normalizedEmail,
        requestKey,
      });
      pendingInvitationRequestKeys.delete(requestScope);
      return {
        code: result.data.code,
        role: result.data.role,
        expiresAt: new Date(result.data.expiresAt),
      };
    } catch (error) {
      if (!isRetryableCallableError(error)) pendingInvitationRequestKeys.delete(requestScope);
      throw error;
    }
  },
  async activateInvitation(input) {
    await activateInvitationCallable({
      code: input.code.trim().toUpperCase(),
      targetEmail: input.targetEmail.trim().toLowerCase(),
      password: input.password,
      fullName: input.fullName.trim(),
    });
  },
  async consumeInvitation(input) {
    await consumeInvitationCallable(input);
  },
};

export const submitInvoiceRecord = async (input: SubmitInvoiceCallableInput) =>
  (await submitInvoiceCallable(input)).data;

export const reviewInvoiceRecord = async (input: {
  invoiceId: string;
  status: InvoiceReviewStatus;
  reviewNotes: string | null;
}) => (await reviewInvoiceCallable(input)).data;

export const extractJobsFromExcelRecord = async (input: {
  projectId: string;
  filePath: string;
}) => (await extractJobsFromExcelCallable(input)).data;

export const listAssignableBuilders = async (): Promise<AssignableBuilder[]> =>
  (await listAssignableBuildersCallable({})).data.builders;

export const createAssignedProjectRecord = async (
  input: CreateAssignedProjectCallableInput,
): Promise<{ projectId: string }> =>
  (await createAssignedProjectCallable(input)).data;

export const accessRequestOperations = {
  async submitAccessRequest(input: {
    requestedRole: AppRole;
    fullName: string;
    phone?: string | null;
  }) {
    return (await submitAccessRequestCallable(input)).data;
  },
  async getAccessRequestStatus(): Promise<{
    status: AccessRequestStatus | null;
    requestedRole: AppRole | null;
  }> {
    return (await getAccessRequestStatusCallable({})).data;
  },
  async listAccessRequests(): Promise<AccessRequestRecord[]> {
    const result = await listAccessRequestsCallable({});
    return result.data.requests.map(toAccessRequestRecord);
  },
  async reviewAccessRequest(input: {
    requestId: string;
    decision: "approve" | "reject";
    reason?: string | null;
  }): Promise<AccessRequestRecord> {
    return toAccessRequestRecord((await reviewAccessRequestCallable(input)).data);
  },
};
