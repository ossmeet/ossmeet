/**
 * Standard error shape from server functions
 */
export interface ServerFunctionError extends Error {
  code?: string;
  statusCode?: number;
}

function getNestedServerErrorValue<T>(
  error: unknown,
  key: "code" | "statusCode",
  isExpectedType: (value: unknown) => value is T,
): T | undefined {
  const queue: unknown[] = [error];
  const seen = new Set<unknown>();

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || (typeof current !== "object" && !(current instanceof Error))) {
      continue;
    }
    if (seen.has(current)) continue;
    seen.add(current);

    const record = current as Record<string, unknown>;
    const direct = record[key];
    if (isExpectedType(direct)) {
      return direct;
    }

    if ("data" in record) queue.push(record.data);
    if ("cause" in record) queue.push(record.cause);
    if ("error" in record) queue.push(record.error);
  }

  return undefined;
}

export function getServerErrorCode(error: unknown): string | undefined {
  return getNestedServerErrorValue(
    error,
    "code",
    (value): value is string => typeof value === "string" && value.length > 0,
  );
}

export function getServerErrorStatusCode(error: unknown): number | undefined {
  return getNestedServerErrorValue(
    error,
    "statusCode",
    (value): value is number => typeof value === "number" && Number.isFinite(value),
  );
}

/**
 * Type guard to check if error is a ServerFunctionError
 */
export function isServerError(error: unknown): error is ServerFunctionError {
  return error instanceof Error &&
    (typeof getServerErrorCode(error) === "string" ||
      typeof getServerErrorStatusCode(error) === "number");
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
