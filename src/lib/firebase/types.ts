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

export type InvitationValidation =
  | {
      valid: true;
      role: AppRole;
      expiresAt: Date;
      errorMessage: null;
    }
  | {
      valid: false;
      role: null;
      expiresAt: null;
      errorMessage: string;
    };

export interface InvitationOperations {
  validateInvitationCode(code: string, targetEmail?: string): Promise<InvitationValidation>;
  createInvitation(input: { role: AppRole; targetEmail: string; requestKey?: string }): Promise<{
    code: string;
    role: AppRole;
    expiresAt: Date;
  }>;
  activateInvitation(input: {
    code: string;
    targetEmail: string;
    password: string;
    fullName: string;
  }): Promise<void>;
  consumeInvitation(input: { code: string }): Promise<void>;
}
