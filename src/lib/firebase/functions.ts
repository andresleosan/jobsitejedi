import { httpsCallable } from "firebase/functions";
import { firebaseFunctions } from "./client";
import type { AppRole } from "./types";
import type { InvitationOperations, InvitationValidation } from "./types";

const createManagerInvitationCallable = httpsCallable<
  { role: AppRole },
  { code: string; expiresAt: string }
>(firebaseFunctions, "createManagerInvitation");

const validateInvitationCodeCallable = httpsCallable<
  { code: string },
  InvitationValidation
>(firebaseFunctions, "validateInvitationCode");

const consumeInvitationCallable = httpsCallable<
  { invitationId: string },
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
  async validateInvitationCode(code) {
    const result = await validateInvitationCodeCallable({ code: code.trim().toUpperCase() });
    return result.data;
  },
  async createInvitation(input) {
    const result = await createManagerInvitationCallable(input);
    return {
      code: result.data.code,
      expiresAt: new Date(result.data.expiresAt),
    };
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
