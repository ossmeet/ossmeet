export class AppError extends Error {
  constructor(
    public code: string,
    message: string,
    public statusCode: number = 500,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const Errors = {
  UNAUTHORIZED: () => new AppError("UNAUTHORIZED", "Not authenticated", 401),
  FORBIDDEN: (message = "Access denied") => new AppError("FORBIDDEN", message, 403),
  NOT_FOUND: (resource = "Resource") =>
    new AppError("NOT_FOUND", `${resource} not found`, 404),
  CONFLICT: (message: string) => new AppError("CONFLICT", message, 409),
  MEETING_NOT_STARTED: () => new AppError("MEETING_NOT_STARTED", "Meeting hasn't started yet", 404),
  MEETING_LOCKED: () => new AppError("MEETING_LOCKED", "The host has locked this meeting", 403),
  AWAITING_APPROVAL: (participantId: string) => {
    const err = new AppError("AWAITING_APPROVAL", "Waiting for the host to admit you", 202);
    (err as AppError & { participantId: string }).participantId = participantId;
    return err;
  },
  RATE_LIMITED: () =>
    new AppError("RATE_LIMITED", "Too many requests. Please try again later.", 429),
  PLAN_LIMIT_REACHED: (limit: string) =>
    new AppError("PLAN_LIMIT_REACHED", `Plan limit reached: ${limit}`, 403),
  VALIDATION: (message: string) =>
    new AppError("VALIDATION_ERROR", message, 400),
  // Standardized error codes for OAuth and config
  OAUTH_ERROR: (message: string) =>
    new AppError("OAUTH_ERROR", message, 400),
  ACCOUNT_LINK_REQUIRED: (message: string) =>
    new AppError("ACCOUNT_LINK_REQUIRED", message, 409),
  CONFIG_ERROR: (message: string) =>
    new AppError("CONFIG_ERROR", message, 500),
  TEMPORARY_EMAIL: () =>
    new AppError("TEMPORARY_EMAIL", "Temporary email addresses are not allowed. Please use a personal or academic email.", 400),
} as const;

export function createValidationError(message: string): AppError {
  return Errors.VALIDATION(message);
}
