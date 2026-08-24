export type AppRole = "manager" | "builder";

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
  assignRole(input: { userId: string; role: AppRole }): Promise<void>;
}
