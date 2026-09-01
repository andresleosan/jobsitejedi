export type AccessRequestRole = "admin" | "manager" | "builder";
export type AccessRequestDecision = "approve" | "reject";

export const ACCESS_REQUEST_SCHEMA_VERSION = 1;

const isAccessRequestRole = (value: unknown): value is AccessRequestRole =>
  value === "admin" || value === "manager" || value === "builder";

const requireText = (value: unknown, label: string, maximumLength: number): string => {
  if (typeof value !== "string") throw new Error(`${label} is required`);
  const normalized = value.trim();
  if (
    !normalized
    || normalized.length > maximumLength
    || [...normalized].some((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint < 32 || codePoint === 127;
    })
  ) {
    throw new Error(`${label} is invalid`);
  }
  return normalized;
};

export interface AccessRequestInput {
  requestedRole: AccessRequestRole;
  fullName: string;
  phone: string | null;
}

export const normalizeAccessRequestInput = (value: unknown): AccessRequestInput => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Access request details are required");
  }
  const payload = value as Record<string, unknown>;
  const requestedRole = typeof payload.requestedRole === "string"
    ? payload.requestedRole.trim().toLowerCase()
    : "";
  if (!isAccessRequestRole(requestedRole)) {
    throw new Error("A valid requested role is required");
  }
  const fullName = requireText(payload.fullName, "Full name", 100);
  const phone = payload.phone == null || payload.phone === ""
    ? null
    : requireText(payload.phone, "Phone", 20);
  if (phone && !/^(\+?[0-9\s\-()]+)$/.test(phone)) {
    throw new Error("Phone is invalid");
  }
  return { requestedRole, fullName, phone };
};

export interface AccessRequestReviewInput {
  requestId: string;
  decision: AccessRequestDecision;
  reason: string | null;
}

export const normalizeAccessRequestReviewInput = (value: unknown): AccessRequestReviewInput => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Access request review details are required");
  }
  const payload = value as Record<string, unknown>;
  const requestId = requireText(payload.requestId, "Request id", 128);
  if (!/^[A-Za-z0-9_-]{10,128}$/.test(requestId)) {
    throw new Error("Request id is invalid");
  }
  if (payload.decision !== "approve" && payload.decision !== "reject") {
    throw new Error("Review decision is invalid");
  }
  const reason = payload.reason == null || payload.reason === ""
    ? null
    : requireText(payload.reason, "Review reason", 500);
  return { requestId, decision: payload.decision, reason };
};
