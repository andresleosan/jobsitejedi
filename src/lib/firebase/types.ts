export type AppRole = "admin" | "manager" | "builder";

export const isAppRole = (value: unknown): value is AppRole =>
  value === "admin" || value === "manager" || value === "builder";

export const isManagementRole = (
  role: AppRole | null | undefined,
): role is "admin" | "manager" => role === "admin" || role === "manager";

export const roleHomePath = (role: AppRole): "/admins" | "/managers" | "/builders" => {
  if (role === "admin") return "/admins";
  return role === "manager" ? "/managers" : "/builders";
};

export interface SessionUser {
  id: string;
  email: string;
  fullName: string;
  role: AppRole | null;
}

export interface InvitationValidation {
  valid: boolean;
  role: AppRole;
  invitationId: string;
  errorMessage: string | null;
}

export interface InvitationOperations {
  validateInvitationCode(code: string): Promise<InvitationValidation>;
  createInvitation(input: { role: AppRole }): Promise<{
    code: string;
    expiresAt: Date;
  }>;
  consumeInvitation(input: { invitationId: string; userId: string }): Promise<void>;
}
