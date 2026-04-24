type LogLevel = "error" | "warn" | "info";
const REDACTED = "[REDACTED]";
const SENSITIVE_KEY_RE = /(pass(word)?|secret|token|api[-_]?key|authorization|cookie|set-cookie|otp|code[_-]?verifier|client[_-]?secret)/i;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) && !(value instanceof Error);
}

function shouldIncludeStack(): boolean {
  const nodeEnv = typeof process !== "undefined" ? process.env.NODE_ENV : undefined;
  const runtimeEnv = typeof globalThis !== "undefined"
    ? (globalThis as { __ENVIRONMENT?: string }).__ENVIRONMENT
    : undefined;
  return nodeEnv !== "production" && runtimeEnv !== "production";
}

function serializeError(error: Error): Record<string, unknown> {
  const out: Record<string, unknown> = {
    name: error.name,
    message: error.message,
  };
  if (shouldIncludeStack() && error.stack) out.stack = error.stack;
  return out;
}

function serializeArg(value: unknown, keyHint?: string): unknown {
  if (keyHint && SENSITIVE_KEY_RE.test(keyHint)) return REDACTED;
  if (value instanceof Error) return serializeError(value);
  if (Array.isArray(value)) return value.map((item) => serializeArg(item));
  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        SENSITIVE_KEY_RE.test(key) ? REDACTED : serializeArg(item, key),
      ])
    );
  }
  return value;
}

function writeLog(level: LogLevel, message: string, ...args: unknown[]): void {
  const entry: Record<string, unknown> = {
    ts: new Date().toISOString(),
    level,
    msg: message,
  };

  let extraArgs = args;
  if (extraArgs.length > 0 && isPlainObject(extraArgs[0])) {
    Object.assign(entry, serializeArg(extraArgs[0]));
    extraArgs = extraArgs.slice(1);
  }

  if (extraArgs.length > 0) {
    entry.args = extraArgs.map((v) => serializeArg(v));
  }

  const line = JSON.stringify(entry);
  if (level === "error") {
    console.error(line);
  } else if (level === "warn") {
    console.warn(line);
  } else {
    console.info(line);
  }
}

export function logError(message: string, ...args: unknown[]): void {
  writeLog("error", message, ...args);
}

export function logWarn(message: string, ...args: unknown[]): void {
  writeLog("warn", message, ...args);
}

export function logInfo(message: string, ...args: unknown[]): void {
  writeLog("info", message, ...args);
}
