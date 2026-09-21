export type ServiceErrorCode =
  | "ACCOUNT_UNAVAILABLE"
  | "BAD_REQUEST"
  | "CONFLICT"
  | "ENTITLEMENT_REQUIRED"
  | "FORBIDDEN"
  | "INTERNAL_ERROR"
  | "INVALID_CREDENTIALS"
  | "NOT_FOUND"
  | "PAYLOAD_TOO_LARGE"
  | "PRECONDITION_FAILED"
  | "PRECONDITION_REQUIRED"
  | "QUOTA_EXCEEDED"
  | "RATE_LIMITED"
  | "STALE_ATTACHMENT"
  | "STALE_COOP_LEASE"
  | "STALE_MATCHMAKING_LEASE"
  | "UNAUTHORIZED"
  | "UNSUPPORTED_MEDIA_TYPE"
  | "UNAVAILABLE";

export class ServiceError extends Error {
  readonly code: ServiceErrorCode;
  readonly status: number;

  constructor(status: number, code: ServiceErrorCode, message: string) {
    super(message);
    this.name = "ServiceError";
    this.status = status;
    this.code = code;
  }
}

export const describeUnknownError = (error: unknown): string =>
  error instanceof Error ? error.message : "Unknown error";
