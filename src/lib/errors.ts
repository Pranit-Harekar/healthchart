export class AppError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string,
    public details?: Array<{ field?: string; issue: string }>,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const ErrorCodes = {
  VALIDATION_ERROR: "VALIDATION_ERROR",
  UNAUTHENTICATED: "UNAUTHENTICATED",
  FORBIDDEN: "FORBIDDEN",
  NOT_FOUND: "NOT_FOUND",
  CONFLICT: "CONFLICT",
  LOCKED: "LOCKED",
  RATE_LIMITED: "RATE_LIMITED",
  INTERNAL_ERROR: "INTERNAL_ERROR",
} as const;

export function createError(
  statusCode: number,
  code: string,
  message: string,
  details?: Array<{ field?: string; issue: string }>,
): AppError {
  return new AppError(statusCode, code, message, details);
}
