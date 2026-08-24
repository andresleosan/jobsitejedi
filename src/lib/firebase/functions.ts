import { httpsCallable } from "firebase/functions";
import { firebaseFunctions } from "./client";
import type { AppRole } from "./types";
import type { InvitationOperations, InvitationValidation } from "./types";

type RoleResponse = { role: AppRole };

const ensureBuilderRoleCallable = httpsCallable<
  { role: "builder" },
  RoleResponse
>(firebaseFunctions, "ensureBuilderRole");

const setUserRoleCallable = httpsCallable<
  { userId: string; role: AppRole },
  { userId: string; role: AppRole }
>(firebaseFunctions, "setUserRole");

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

export const ensureBuilderRole = async (): Promise<void> => {
  const result = await ensureBuilderRoleCallable({ role: "builder" });

  if (result.data.role !== "builder") {
    throw new Error("Unable to assign the builder role");
  }
};

export const assignUserRole = async (input: {
  userId: string;
  role: AppRole;
}): Promise<void> => {
  await setUserRoleCallable(input);
};

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
  async assignRole(input) {
    await assignUserRole(input);
  },
};
