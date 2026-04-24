/**
 * Standard error shape from server functions
 */
export interface ServerFunctionError extends Error {
  code?: string;
  statusCode?: number;
}

/**
 * Type guard to check if error is a ServerFunctionError
 */
export function isServerError(error: unknown): error is ServerFunctionError {
  return (
    error instanceof Error &&
    (typeof (error as ServerFunctionError).code === "string" ||
      typeof (error as ServerFunctionError).statusCode === "number")
  );
}

/**
 * Safely get error message from unknown error
 */
export function getErrorMessage(error: unknown, fallback = "Something went wrong"): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  if (error && typeof error === "object" && "message" in error) {
    return String(error.message);
  }
  return fallback;
}
