import { parseTrustedProxyList } from "../security";

export interface WhiteboardServerConfig {
  port: number;
  dataDir: string;
  appUrl: string;
  whiteboardInternalSecret: string;
  whiteboardJwtSecret: string;
  pdfImportR2Config: {
    accessKeyId: string;
    secretAccessKey: string;
    accountId: string;
    bucketName: string;
  };
  snapshotCallbackUrl: string;
  whiteboardAccessValidationUrl: string;
  allowedOrigins: string[];
  allowInsecureAllOrigins: boolean;
  trustedProxyIps: ReturnType<typeof parseTrustedProxyList>;
}

function formatLogArg(arg: unknown): unknown {
  if (arg instanceof Error) {
    return {
      name: arg.name,
      message: arg.message,
      stack: arg.stack,
    };
  }
  return arg;
}

function installStructuredLogging(logFormat: string): void {
  if (logFormat !== "json") return;

  const emit = (level: "info" | "warn" | "error", args: unknown[]) => {
    const first = args[0];
    const payload = {
      ts: new Date().toISOString(),
      level,
      msg: typeof first === "string" ? first : "log",
      data: args.map(formatLogArg),
    };
    const line = JSON.stringify(payload);
    if (level === "error") {
      process.stderr.write(line + "\n");
      return;
    }
    process.stdout.write(line + "\n");
  };

  console.info = (...args: unknown[]) => emit("info", args);
  console.warn = (...args: unknown[]) => emit("warn", args);
  console.error = (...args: unknown[]) => emit("error", args);
}

function readSecret(envVar: string): string {
  const fileVar = process.env[envVar + "_FILE"];
  if (fileVar) {
    try {
      const fs = require("fs");
      return fs.readFileSync(fileVar, "utf-8").trim();
    } catch {
      console.error(`Failed to read secret file ${fileVar} for ${envVar}`);
    }
  }
  return process.env[envVar] || "";
}

function isLocalAppUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    return url.hostname === "localhost" || url.hostname === "127.0.0.1";
  } catch {
    return false;
  }
}

export function loadWhiteboardServerConfig(): WhiteboardServerConfig {
  installStructuredLogging((process.env.LOG_FORMAT || "plain").toLowerCase());

  const whiteboardInternalSecret = readSecret("WHITEBOARD_INTERNAL_SECRET");
  const whiteboardJwtSecret = readSecret("WHITEBOARD_JWT_SECRET");
  if (!whiteboardInternalSecret) {
    console.error("WHITEBOARD_INTERNAL_SECRET is required");
    process.exit(1);
  }
  if (!whiteboardJwtSecret) {
    console.error("WHITEBOARD_JWT_SECRET is required (must be distinct from WHITEBOARD_INTERNAL_SECRET)");
    process.exit(1);
  }

  const appUrl = (process.env.APP_URL || "").trim().replace(/\/+$/, "");
  if (!appUrl) {
    console.error("APP_URL is required for whiteboard auth validation and snapshot callbacks");
    process.exit(1);
  }

  const allowedOrigins = (process.env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const allowInsecureAllOrigins =
    process.env.ALLOW_INSECURE_ALL_ORIGINS === "true" ||
    (isLocalAppUrl(appUrl) && process.env.NODE_ENV === "development");

  if (allowedOrigins.length === 0) {
    if (!allowInsecureAllOrigins) {
      console.error(
        "[whiteboard-server] ALLOWED_ORIGINS is required unless ALLOW_INSECURE_ALL_ORIGINS=true.",
      );
      process.exit(1);
    }
    console.warn("[whiteboard-server] ALLOWED_ORIGINS is not set — allowing all origins (development mode).");
  }

  return {
    port: Number(process.env.PORT || 8787),
    dataDir: process.env.DATA_DIR || "/data/rooms",
    appUrl,
    whiteboardInternalSecret,
    whiteboardJwtSecret,
    pdfImportR2Config: {
      accessKeyId: readSecret("R2_ACCESS_KEY_ID"),
      secretAccessKey: readSecret("R2_SECRET_ACCESS_KEY"),
      accountId: readSecret("R2_ACCOUNT_ID"),
      bucketName: readSecret("R2_BUCKET_NAME"),
    },
    snapshotCallbackUrl: `${appUrl}/api/whiteboard/snapshot`,
    whiteboardAccessValidationUrl: `${appUrl}/api/whiteboard/access`,
    allowedOrigins,
    allowInsecureAllOrigins,
    trustedProxyIps: parseTrustedProxyList(process.env.TRUST_PROXY_IPS),
  };
}
