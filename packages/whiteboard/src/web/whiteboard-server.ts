import type { JoinResult } from "@/lib/meeting/types";
import { createWhiteboardJWT } from "../lib/whiteboard-jwt";
import { setWhiteboardAssetCookie, clearWhiteboardAssetCookie } from "./lib/whiteboard-cookies.ts";
import { buildRecorderUrl } from "../lib/recorder-url";

export interface JoinAccessHookParams {
  participantIdentity: string;
  participantName: string;
  participantRole: "host" | "participant" | "guest" | string;
  meetingId: string;
  connectionId: string;
}

export interface WhiteboardStatusMonitor {
  service: "livekit" | "whiteboard";
  name: string;
  id?: string | null;
}

export async function buildWhiteboardJoinAccessExtras(
  env: Env,
  params: JoinAccessHookParams
): Promise<Partial<JoinResult>> {
  const whiteboardUrl = env.WHITEBOARD_URL?.trim() ?? "";
  const whiteboardSecret = env.WHITEBOARD_JWT_SECRET?.trim() ?? "";

  if (!whiteboardUrl) {
    return {
      whiteboardEnabled: false,
      whiteboardDisabledReason: null,
      whiteboardToken: null,
      whiteboardUrl: null,
    };
  }

  if (!whiteboardSecret) {
    return {
      whiteboardEnabled: false,
      whiteboardDisabledReason: "Whiteboard authentication is not configured.",
      whiteboardToken: null,
      whiteboardUrl: null,
    };
  }

  const whiteboardRole =
    params.participantRole === "host"
      ? "host"
      : params.participantRole === "participant"
        ? "participant"
        : "guest";

  const whiteboardToken = await createWhiteboardJWT(whiteboardSecret, {
    sub: params.participantIdentity,
    name: params.participantName,
    role: whiteboardRole,
    sid: `meet-${params.meetingId}`,
    connectionId: params.connectionId,
  });

  setWhiteboardAssetCookie(params.meetingId, whiteboardToken, {
    appUrl: env.APP_URL,
    environment: env.ENVIRONMENT,
  });

  return {
    whiteboardEnabled: true,
    whiteboardDisabledReason: null,
    whiteboardToken,
    whiteboardUrl,
  };
}

export async function getWhiteboardRecorderCustomBaseUrl(
  env: Env,
  meetingId: string,
  options: { meetingCode?: string | null } = {},
): Promise<string | undefined> {
  if (!env.WHITEBOARD_URL || !env.WHITEBOARD_JWT_SECRET) {
    return undefined;
  }

  const wbToken = await createWhiteboardJWT(
    env.WHITEBOARD_JWT_SECRET,
    {
      sub: "recorder",
      name: "Recorder",
      role: "guest",
      sid: `meet-${meetingId}`,
      connectionId: "recorder",
      service: "recorder",
    },
    24 * 3600
  );

  return buildRecorderUrl(env.APP_URL, env.WHITEBOARD_URL, wbToken, {
    meetingCode: options.meetingCode,
  });
}

export async function notifyWhiteboardMeetingFinalized(
  env: Env,
  meetingId: string
): Promise<void> {
  if (!env.WHITEBOARD_URL || !env.WHITEBOARD_INTERNAL_SECRET) return;
  const baseUrl = env.WHITEBOARD_URL.trim().replace(/\/+$/, "");
  const response = await fetch(`${baseUrl}/session-end`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Whiteboard-Secret": env.WHITEBOARD_INTERNAL_SECRET,
    },
    body: JSON.stringify({ sessionId: `meet-${meetingId}` }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    throw new Error(`Whiteboard session-end returned ${response.status}`);
  }
}

export async function notifyWhiteboardActingManagerPromoted(
  env: Env,
  meetingId: string,
  identity: string
): Promise<void> {
  if (!env.WHITEBOARD_URL || !env.WHITEBOARD_INTERNAL_SECRET) return;
  const baseUrl = env.WHITEBOARD_URL.trim().replace(/\/+$/, "");
  const roomName = `meet-${meetingId}`;
  try {
    await fetch(`${baseUrl}/manager/promote`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Whiteboard-Secret": env.WHITEBOARD_INTERNAL_SECRET,
      },
      body: JSON.stringify({ sessionId: roomName, userId: identity }),
      signal: AbortSignal.timeout(6_000),
    });
  } catch (err) {
    console.error("[meetingSessions] Whiteboard acting manager promotion failed:", err);
  }
}

export const notifyWhiteboardHostPromoted = notifyWhiteboardActingManagerPromoted;

export function getWhiteboardStatusMonitors(env: Env): WhiteboardStatusMonitor[] {
  if (!env.WHITEBOARD_URL) return [];
  return [
    {
      service: "whiteboard",
      name: "Whiteboard",
      id: env.UPTIMEROBOT_MONITOR_WHITEBOARD_ID,
    },
  ];
}

export function getWhiteboardCspDomains(env: Env): string[] {
  if (!env.WHITEBOARD_URL) return [];
  try {
    const domain = new URL(env.WHITEBOARD_URL).hostname;
    return domain ? [domain] : [];
  } catch {
    return [];
  }
}

export function clearWhiteboardMeetingCookies(env: Env, meetingId: string): void {
  clearWhiteboardAssetCookie(meetingId, {
    appUrl: env.APP_URL,
    environment: env.ENVIRONMENT,
  });
}

export async function validateWhiteboardAssetUpload(
  env: Env,
  data: {
    internalSecret: string | null;
    type: string;
    sessionId: string | null;
    spaceId: string;
    r2Key: string;
  }
): Promise<{ uploadedById: string; registerAsMeetingArtifact: boolean; meetingArtifactType: string } | null> {
  if (!data.internalSecret || !env.WHITEBOARD_INTERNAL_SECRET) return null;

  const enc = new TextEncoder();
  const hmacKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(env.WHITEBOARD_INTERNAL_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const fixedMsg = enc.encode("ossmeet-whiteboard-auth");
  const providedKeyMaterial = await crypto.subtle.importKey(
    "raw",
    enc.encode(data.internalSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const providedDigest = new Uint8Array(
    await crypto.subtle.sign("HMAC", providedKeyMaterial, fixedMsg),
  );
  const expectedDigest = new Uint8Array(
    await crypto.subtle.sign("HMAC", hmacKey, fixedMsg),
  );
  const secretValid = crypto.subtle.timingSafeEqual(providedDigest, expectedDigest);

  if (!secretValid) return null;

  if (data.type === "pdf") {
    throw new Error("Server-to-server asset registration only supports meeting artifacts");
  }
  if (!data.sessionId) {
    throw new Error("sessionId is required for server-to-server calls");
  }

  const { createDb } = await import("@ossmeet/db");
  const db = createDb(env.DB);
  const { meetingSessions } = await import("@ossmeet/db/schema");
  const { and, eq } = await import("drizzle-orm");

  const meeting = await db.query.meetingSessions.findFirst({
    where: and(eq(meetingSessions.id, data.sessionId), eq(meetingSessions.spaceId, data.spaceId)),
    columns: { id: true, hostId: true },
  });
  if (!meeting) throw new Error("Meeting does not belong to this space");

  const validPrefix =
    data.r2Key.startsWith("recordings/") ||
    data.r2Key.startsWith("whiteboards/") ||
    data.r2Key.startsWith("whiteboard/");
  if (!validPrefix) {
    throw new Error("Invalid r2Key for meeting artifact");
  }

  return {
    uploadedById: meeting.hostId,
    registerAsMeetingArtifact: true,
    meetingArtifactType: data.type,
  };
}
