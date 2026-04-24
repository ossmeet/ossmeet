import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { createDb, type Database } from "@ossmeet/db";
import {
  meetingSessions,
  meetingParticipants,
} from "@ossmeet/db/schema";
import { and, desc, eq, inArray } from "drizzle-orm";
import {
  CURRENT_MEETING_PARTICIPANT_STATUSES,
  saveWhiteboardSnapshotSchema,
  Errors,
  AppError,
} from "@ossmeet/shared";
import { createWhiteboardJWT } from "@/lib/jwt-utils";
import { whiteboardSnapshotKey } from "@/lib/r2-key";
import { logError, logWarn } from "@/lib/logger";
import { buildR2Client } from "../upload";
import { withD1Retry } from "@/lib/db-utils";
import {
  assertActiveMeetingParticipantWithSpaceAccess,
  assertMeetingExists,
} from "./access-assertions";
import { registerMeetingArtifactMetadata } from "../assets/register";

const AUTH_HELPERS_MODULE = "../auth/helpers";
const loadAuthHelpers = () => import(/* @vite-ignore */ AUTH_HELPERS_MODULE);
type AuthHelpers = Awaited<ReturnType<typeof loadAuthHelpers>>;

// ─── Internal helpers ────────────────────────────────────────────────

const WHITEBOARD_TIMEOUT_MS = 6_000;
const WHITEBOARD_RETRIES_PER_BASE = 1;
const WHITEBOARD_CIRCUIT_COOLDOWN_MS = 30_000;
const whiteboardCircuitOpenUntil = new Map<string, number>();

function getWhiteboardBaseUrls(env: Env): string[] {
  const extra = ((env as Env & { WHITEBOARD_URLS?: string }).WHITEBOARD_URLS ?? "")
    .split(",")
    .map((u) => u.trim())
    .filter(Boolean);
  const bases = [env.WHITEBOARD_URL, ...extra]
    .map((u) => (u ?? "").trim().replace(/\/+$/, ""))
    .filter(Boolean);
  return Array.from(new Set(bases));
}

function isWhiteboardConfigured(env: Env): boolean {
  return getWhiteboardBaseUrls(env).length > 0 && !!env.WHITEBOARD_INTERNAL_SECRET;
}

function getPrimaryWhiteboardUrl(env: Env): string {
  const [primary] = getWhiteboardBaseUrls(env);
  if (!primary) throw Errors.CONFIG_ERROR("Whiteboard not configured");
  return primary;
}

function isCircuitOpen(baseUrl: string, now: number): boolean {
  const until = whiteboardCircuitOpenUntil.get(baseUrl);
  if (!until) return false;
  if (until <= now) {
    whiteboardCircuitOpenUntil.delete(baseUrl);
    return false;
  }
  return true;
}

function openCircuit(baseUrl: string, now: number): void {
  whiteboardCircuitOpenUntil.set(baseUrl, now + WHITEBOARD_CIRCUIT_COOLDOWN_MS);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type WhiteboardApiResponse = {
  success: boolean;
  status?: string;
  writerUserIds?: string[];
  presenterUserId?: string | null;
  presenterName?: string | null;
  aiPanelOpen?: boolean;
  connectedUsers?: Array<{ userId: string; userName: string }>;
  pendingRequests?: Array<{ userId: string; userName: string }>;
  pageNumber?: number;
};

/**
 * Verify whiteboard is configured, find the active meeting, and assert the
 * caller is the host. Used by all host-only whiteboard API proxy functions.
 */
async function requireActiveWhiteboardMeetingAsHost(
  db: Database,
  meetingId: string,
  userId: string,
  env: Env,
) {
  if (!isWhiteboardConfigured(env)) {
    throw Errors.CONFIG_ERROR("Whiteboard not configured");
  }
  const meeting = await assertMeetingExists(db, meetingId, { requireActive: true });
  if (meeting.hostId !== userId) throw Errors.FORBIDDEN();
  return meeting;
}

async function resolveAuthenticatedParticipantIdentity(
  db: Database,
  meetingId: string,
  userId: string,
  participantId?: string,
) {
  const participant = participantId
    ? await db.query.meetingParticipants.findFirst({
        where: and(
          eq(meetingParticipants.sessionId, meetingId),
          eq(meetingParticipants.id, participantId),
          eq(meetingParticipants.userId, userId),
          inArray(meetingParticipants.status, CURRENT_MEETING_PARTICIPANT_STATUSES),
        ),
      })
    : await db.query.meetingParticipants.findFirst({
        where: and(
          eq(meetingParticipants.sessionId, meetingId),
          eq(meetingParticipants.userId, userId),
          inArray(meetingParticipants.status, CURRENT_MEETING_PARTICIPANT_STATUSES),
        ),
        orderBy: [desc(meetingParticipants.joinedAt), desc(meetingParticipants.id)],
      });

  if (!participant) throw Errors.FORBIDDEN();

  return {
    identity: participant.livekitIdentity ?? userId,
    displayName: participant.displayName ?? "User",
  };
}

async function resolveActiveWhiteboardCallerIdentity(
  db: Database,
  env: Env,
  meetingId: string,
  participantId: string | undefined,
  rateLimitPrefix: string,
  auth: Pick<
    AuthHelpers,
    "getClientIP" | "requireAuth" | "enforceRateLimit" | "verifyGuestParticipant"
  >,
) {
  if (!isWhiteboardConfigured(env)) {
    throw Errors.CONFIG_ERROR("Whiteboard not configured");
  }

  const meeting = await assertMeetingExists(db, meetingId, { requireActive: true });

  let user: { id: string } | null = null;
  try {
    user = await auth.requireAuth();
  } catch (err) {
    if (!(err instanceof AppError && err.code === "UNAUTHORIZED")) throw err;
  }

  if (user) {
    await auth.enforceRateLimit(env, `${rateLimitPrefix}:${user.id}`);
    await assertActiveMeetingParticipantWithSpaceAccess(db, meeting.id, user.id);
    const participantIdentity = await resolveAuthenticatedParticipantIdentity(
      db,
      meeting.id,
      user.id,
      participantId,
    );
    return { meeting, participantIdentity };
  }

  if (!participantId) throw Errors.UNAUTHORIZED();

  await auth.enforceRateLimit(env, `${rateLimitPrefix}:guest:${participantId}`);
  await auth.enforceRateLimit(env, `${rateLimitPrefix}:ip:${auth.getClientIP()}`);

  const guestParticipant = await auth.verifyGuestParticipant(db, meeting.id, participantId);
  return {
    meeting,
    participantIdentity: {
      identity: guestParticipant.livekitIdentity ?? `guest_${guestParticipant.id}`,
      displayName: guestParticipant.displayName ?? "Guest",
    },
  };
}

/**
 * POST or GET a whiteboard server endpoint and return the parsed JSON response.
 * Throws on non-OK status.
 */
async function callWhiteboardApi(
  env: Env,
  path: string,
  options?: { method?: string; body?: unknown },
): Promise<WhiteboardApiResponse> {
  const method = options?.method ?? "POST";
  const baseUrls = getWhiteboardBaseUrls(env);
  if (baseUrls.length === 0 || !env.WHITEBOARD_INTERNAL_SECRET) {
    throw Errors.CONFIG_ERROR("Whiteboard not configured");
  }

  const now = Date.now();
  const healthy = baseUrls.filter((baseUrl) => !isCircuitOpen(baseUrl, now));
  const candidates = healthy.length > 0 ? healthy : baseUrls;

  for (const baseUrl of candidates) {
    for (let attempt = 0; attempt <= WHITEBOARD_RETRIES_PER_BASE; attempt++) {
      try {
        const response = await fetch(`${baseUrl}${path}`, {
          method,
          headers: {
            ...(options?.body != null ? { "Content-Type": "application/json" } : {}),
            "X-Whiteboard-Secret": env.WHITEBOARD_INTERNAL_SECRET,
          },
          body: options?.body != null ? JSON.stringify(options.body) : undefined,
          signal: AbortSignal.timeout(WHITEBOARD_TIMEOUT_MS),
        });

        if (!response.ok) {
          if (response.status >= 500 || response.status === 429) {
            throw new Error(`Whiteboard API ${response.status} (${baseUrl}${path})`);
          }
          throw Errors.VALIDATION(`Whiteboard request failed (${response.status})`);
        }

        whiteboardCircuitOpenUntil.delete(baseUrl);
        const contentType = response.headers.get("Content-Type") ?? "";
        if (contentType.includes("application/json")) {
          const data = await response.json();
          if (data && typeof data === "object" && !Array.isArray(data)) {
            const record = data as Record<string, unknown>;
            const writerUserIds = Array.isArray(record.writerUserIds)
              ? record.writerUserIds.filter((value): value is string => typeof value === "string")
              : undefined;
            const connectedUsers = Array.isArray(record.connectedUsers)
              ? record.connectedUsers.filter(
                  (value): value is { userId: string; userName: string } =>
                    !!value &&
                    typeof value === "object" &&
                    typeof (value as { userId?: unknown }).userId === "string" &&
                    typeof (value as { userName?: unknown }).userName === "string"
                )
              : undefined;
            const pendingRequests = Array.isArray(record.pendingRequests)
              ? record.pendingRequests.filter(
                  (value): value is { userId: string; userName: string } =>
                    !!value &&
                    typeof value === "object" &&
                    typeof (value as { userId?: unknown }).userId === "string" &&
                    typeof (value as { userName?: unknown }).userName === "string"
                )
              : undefined;

            return {
              success: typeof record.success === "boolean" ? record.success : true,
              status: typeof record.status === "string" ? record.status : undefined,
              writerUserIds,
              presenterUserId:
                typeof record.presenterUserId === "string" || record.presenterUserId === null
                  ? record.presenterUserId
                  : undefined,
              presenterName:
                typeof record.presenterName === "string" || record.presenterName === null
                  ? record.presenterName
                  : undefined,
              aiPanelOpen: typeof record.aiPanelOpen === "boolean" ? record.aiPanelOpen : undefined,
              connectedUsers,
              pendingRequests,
              pageNumber: typeof record.pageNumber === "number" ? record.pageNumber : undefined,
            };
          }
          return { success: true };
        }
        return { success: true };
      } catch (err) {
        const callError = err instanceof Error ? err : new Error(String(err));
        if (attempt < WHITEBOARD_RETRIES_PER_BASE) {
          await sleep(150 * (attempt + 1));
          continue;
        }
        openCircuit(baseUrl, Date.now());
        logWarn("[whiteboard] endpoint marked unhealthy", { baseUrl, path, method }, callError);
      }
    }
  }

  throw new AppError("WHITEBOARD_UNAVAILABLE", "Whiteboard service unavailable", 503);
}

// ─── getWhiteboardToken ──────────────────────────────────────────────

const getWhiteboardTokenSchema = z.object({
  meetingId: z.string().min(1),
  participantId: z.string().min(1).optional(),
});

export const getWhiteboardToken = createServerFn({ method: "POST" })
  .inputValidator(getWhiteboardTokenSchema)
  .handler(async ({ data }) => {
    const { getEnv, getClientIP, requireAuth, enforceRateLimit, verifyGuestParticipant } =
      await loadAuthHelpers();
    const env = await getEnv();
    const db = createDb(env.DB);
    const clientIP = getClientIP();

    let userId: string | null = null;
    let userName: string | null = null;
    try {
      const user = await requireAuth();
      userId = user.id;
      userName = user.name || user.email;
    } catch (err) {
      // Only swallow auth errors — rethrow infrastructure failures
      if (!(err instanceof AppError && err.code === "UNAUTHORIZED")) throw err;
    }

    await enforceRateLimit(
      env,
      userId
        ? `whiteboard:token:${userId}`
        : data.participantId
          ? `whiteboard:token:guest:${data.participantId}`
          : `whiteboard:token:guest:${clientIP}`
    );

    if (!isWhiteboardConfigured(env) || !env.WHITEBOARD_JWT_SECRET) {
      throw Errors.CONFIG_ERROR("Whiteboard not configured");
    }

    const meeting = await assertMeetingExists(db, data.meetingId, { requireActive: true });

    if (userId) {
      await assertActiveMeetingParticipantWithSpaceAccess(db, meeting.id, userId);
      const participantIdentity = await resolveAuthenticatedParticipantIdentity(
        db,
        meeting.id,
        userId,
        data.participantId
      );

      const isHost = meeting.hostId === userId;
      const token = await createWhiteboardJWT(env.WHITEBOARD_JWT_SECRET, {
        sub: participantIdentity.identity,
        name: participantIdentity.displayName || userName || "User",
        role: isHost ? "host" : "participant",
        sid: `meet-${meeting.id}`,
      });

      return { token, whiteboardUrl: getPrimaryWhiteboardUrl(env) };
    }

    // Guest path: verify meeting participant ownership with guest secret from HttpOnly cookie
    if (!data.participantId) throw Errors.UNAUTHORIZED();

    const guestParticipant = await verifyGuestParticipant(db, meeting.id, data.participantId);

    const token = await createWhiteboardJWT(env.WHITEBOARD_JWT_SECRET, {
      sub: guestParticipant.livekitIdentity ?? `guest_${guestParticipant.id}`,
      name: guestParticipant.displayName || "Guest",
      role: "guest",
      sid: `meet-${meeting.id}`,
    });

    return { token, whiteboardUrl: getPrimaryWhiteboardUrl(env) };
  });

// ─── saveWhiteboardSnapshot ──────────────────────────────────────────

export const saveWhiteboardSnapshot = createServerFn({ method: "POST" })
  .inputValidator(saveWhiteboardSnapshotSchema)
  .handler(async ({ data }) => {
    const { requireAuth, getEnv, enforceRateLimit } = await loadAuthHelpers();
    const user = await requireAuth();
    const env = await getEnv();
    const db = createDb(env.DB);

    await enforceRateLimit(env, `whiteboard:snapshot:${user.id}`);

    const meeting = await assertMeetingExists(db, data.sessionId, { requireActive: true });
    if (meeting.hostId !== user.id) throw Errors.FORBIDDEN();

    // Validate the r2Key belongs to this meeting to prevent cross-meeting overwrites
    if (!data.r2Key.startsWith(`whiteboards/${data.sessionId}/`)) {
      throw Errors.VALIDATION("r2Key must match the current meeting");
    }

    const now = new Date();
    await withD1Retry(() =>
      db
        .update(meetingSessions)
        .set({ updatedAt: now })
        .where(eq(meetingSessions.id, meeting.id))
    );

    try {
      // Get the actual object size from R2 instead of recording size: 0,
      // which would allow unlimited snapshot storage without consuming quota.
      let snapshotSize = 0;
      try {
        const r2Object = await env.R2_BUCKET.head(data.r2Key);
        if (r2Object) snapshotSize = r2Object.size;
      } catch {
        // Non-fatal: proceed with size 0 if R2 head fails
      }

      await registerMeetingArtifactMetadata(db, {
        spaceId: meeting.spaceId,
        meetingId: meeting.id,
        type: "whiteboard_snapshot",
        r2Key: data.r2Key,
        filename: `whiteboard-${meeting.id}.png`,
        mimeType: "image/png",
        size: snapshotSize,
        uploadedById: user.id,
        createdAt: now,
      });
    } catch (err) {
      logError(`[whiteboard] Failed to save snapshot asset for meeting ${meeting.id}:`, err);
    }

    return { success: true };
  });

const getWhiteboardSnapshotUploadUrlSchema = z.object({
  meetingId: z.string().min(1),
  fileSize: z.number().int().positive().max(20 * 1024 * 1024),
  mimeType: z.literal("image/png"),
});

export const getWhiteboardSnapshotUploadUrl = createServerFn({ method: "POST" })
  .inputValidator(getWhiteboardSnapshotUploadUrlSchema)
  .handler(async ({ data }) => {
    const { getEnv, requireAuth, enforceRateLimit } = await loadAuthHelpers();
    const env = await getEnv();
    const db = createDb(env.DB);
    const user = await requireAuth();
    const meeting = await requireActiveWhiteboardMeetingAsHost(
      db,
      data.meetingId,
      user.id,
      env
    );

    if (!env.R2_BUCKET_NAME) {
      throw Errors.CONFIG_ERROR("Storage not configured");
    }

    await enforceRateLimit(env, `whiteboard:snapshot-upload:${user.id}`);

    const r2Key = whiteboardSnapshotKey(meeting.id);
    const { r2, endpoint } = buildR2Client(env);
    const url = new URL(`/${env.R2_BUCKET_NAME}/${r2Key}`, endpoint);
    url.searchParams.set("X-Amz-Expires", "600");

    const signed = await r2.sign(
      new Request(url.toString(), {
        method: "PUT",
        headers: {
          "Content-Type": data.mimeType,
          "Content-Length": String(data.fileSize),
        },
      }),
      { aws: { signQuery: true } }
    );

    return { uploadUrl: signed.url, r2Key };
  });

// ─── requestWhiteboardWrite ──────────────────────────────────────────

const requestWhiteboardWriteSchema = z.object({
  meetingId: z.string().min(1),
  participantId: z.string().min(1).optional(),
});

export const requestWhiteboardWrite = createServerFn({ method: "POST" })
  .inputValidator(requestWhiteboardWriteSchema)
  .handler(async ({ data }) => {
    const { getEnv, getClientIP, requireAuth, enforceRateLimit, verifyGuestParticipant } =
      await loadAuthHelpers();
    const env = await getEnv();
    const db = createDb(env.DB);
    const clientIP = getClientIP();
    let writerRole: "host" | "participant" | "guest" = "participant";

    let userId: string | null = null;
    let userName: string | null = null;
    try {
      const user = await requireAuth();
      userId = user.id;
      userName = user.name || user.email;
    } catch (err) {
      if (!(err instanceof AppError && err.code === "UNAUTHORIZED")) throw err;
    }

    await enforceRateLimit(
      env,
      userId
        ? `whiteboard:writer-request:${userId}`
        : `whiteboard:writer-request:guest:${clientIP}`
    );

    if (!isWhiteboardConfigured(env)) {
      throw Errors.CONFIG_ERROR("Whiteboard not configured");
    }

    const meeting = await assertMeetingExists(db, data.meetingId, { requireActive: true });

    if (userId) {
      await assertActiveMeetingParticipantWithSpaceAccess(db, meeting.id, userId);
      const participantIdentity = await resolveAuthenticatedParticipantIdentity(
        db,
        meeting.id,
        userId,
        data.participantId
      );

      writerRole = meeting.hostId === userId ? "host" : "participant";
      userId = participantIdentity.identity;
      userName = participantIdentity.displayName || userName;
    } else {
      // Guest path: read secret from HttpOnly cookie
      if (!data.participantId) throw Errors.UNAUTHORIZED();

      const guestParticipant = await verifyGuestParticipant(db, meeting.id, data.participantId);
      userId = guestParticipant.livekitIdentity ?? `guest_${guestParticipant.id}`;
      userName = guestParticipant.displayName || "Guest";
      writerRole = "guest";
    }

    return callWhiteboardApi(env, "/writer/request", {
      body: { sessionId: `meet-${meeting.id}`, userId, userName, role: writerRole },
    });
  });

// ─── approveWhiteboardWrite ──────────────────────────────────────────

const approveWhiteboardWriteSchema = z.object({
  meetingId: z.string().min(1),
  targetUserId: z.string().min(1),
  participantId: z.string().min(1).optional(),
});

export const approveWhiteboardWrite = createServerFn({ method: "POST" })
  .inputValidator(approveWhiteboardWriteSchema)
  .handler(async ({ data }) => {
    const { getEnv, requireAuth, enforceRateLimit } = await loadAuthHelpers();
    const env = await getEnv();
    const db = createDb(env.DB);
    const user = await requireAuth();
    await enforceRateLimit(env, `whiteboard:writer-approve:${user.id}`);
    const meeting = await requireActiveWhiteboardMeetingAsHost(db, data.meetingId, user.id, env);
    const participantIdentity = await resolveAuthenticatedParticipantIdentity(
      db,
      meeting.id,
      user.id,
      data.participantId
    );

    return callWhiteboardApi(env, "/writer/approve", {
      body: {
        sessionId: `meet-${meeting.id}`,
        targetUserId: data.targetUserId,
        approverId: participantIdentity.identity,
      },
    });
  });

// ─── denyWhiteboardWrite ─────────────────────────────────────────────

const denyWhiteboardWriteSchema = z.object({
  meetingId: z.string().min(1),
  targetUserId: z.string().min(1),
  participantId: z.string().min(1).optional(),
});

export const denyWhiteboardWrite = createServerFn({ method: "POST" })
  .inputValidator(denyWhiteboardWriteSchema)
  .handler(async ({ data }) => {
    const { getEnv, requireAuth, enforceRateLimit } = await loadAuthHelpers();
    const env = await getEnv();
    const db = createDb(env.DB);
    const user = await requireAuth();
    await enforceRateLimit(env, `whiteboard:writer-deny:${user.id}`);
    const meeting = await requireActiveWhiteboardMeetingAsHost(db, data.meetingId, user.id, env);
    const participantIdentity = await resolveAuthenticatedParticipantIdentity(
      db,
      meeting.id,
      user.id,
      data.participantId
    );

    return callWhiteboardApi(env, "/writer/deny", {
      body: {
        sessionId: `meet-${meeting.id}`,
        targetUserId: data.targetUserId,
        approverId: participantIdentity.identity,
      },
    });
  });

// ─── getWhiteboardState ──────────────────────────────────────────────

const getWhiteboardStateSchema = z.object({
  meetingId: z.string().min(1),
});

export const getWhiteboardState = createServerFn({ method: "POST" })
  .inputValidator(getWhiteboardStateSchema)
  .handler(async ({ data }) => {
    const { getEnv, requireAuth, enforceRateLimit } = await loadAuthHelpers();
    const env = await getEnv();
    const db = createDb(env.DB);
    const user = await requireAuth();
    await enforceRateLimit(env, `whiteboard:state:${user.id}`);
    const meeting = await requireActiveWhiteboardMeetingAsHost(db, data.meetingId, user.id, env);

    return callWhiteboardApi(env, `/state/meet-${meeting.id}`, { method: "GET" });
  });

// ─── setWhiteboardPresenter ──────────────────────────────────────────

const setWhiteboardPresenterSchema = z.object({
  meetingId: z.string().min(1),
  targetUserId: z.string().min(1),
  participantId: z.string().min(1).optional(),
});

export const setWhiteboardPresenter = createServerFn({ method: "POST" })
  .inputValidator(setWhiteboardPresenterSchema)
  .handler(async ({ data }) => {
    const { getEnv, requireAuth, enforceRateLimit } = await loadAuthHelpers();
    const env = await getEnv();
    const db = createDb(env.DB);
    const user = await requireAuth();
    await enforceRateLimit(env, `whiteboard:presenter-set:${user.id}`);
    const meeting = await requireActiveWhiteboardMeetingAsHost(db, data.meetingId, user.id, env);
    const participantIdentity = await resolveAuthenticatedParticipantIdentity(
      db,
      meeting.id,
      user.id,
      data.participantId
    );

    return callWhiteboardApi(env, "/presenter/set", {
      body: {
        sessionId: `meet-${meeting.id}`,
        targetUserId: data.targetUserId,
        approverId: participantIdentity.identity,
      },
    });
  });

// ─── releaseWhiteboardPresenter ──────────────────────────────────────

const releaseWhiteboardPresenterSchema = z.object({
  meetingId: z.string().min(1),
  participantId: z.string().min(1).optional(),
});

export const releaseWhiteboardPresenter = createServerFn({ method: "POST" })
  .inputValidator(releaseWhiteboardPresenterSchema)
  .handler(async ({ data }) => {
    const auth = await loadAuthHelpers();
    const env = await auth.getEnv();
    const db = createDb(env.DB);
    const { meeting, participantIdentity } = await resolveActiveWhiteboardCallerIdentity(
      db,
      env,
      data.meetingId,
      data.participantId,
      "whiteboard:presenter-release",
      auth,
    );

    return callWhiteboardApi(env, "/presenter/release", {
      body: { sessionId: `meet-${meeting.id}`, requesterId: participantIdentity.identity },
    });
  });

// ─── syncWhiteboardPage ──────────────────────────────────────────────

const syncWhiteboardPageSchema = z.object({
  meetingId: z.string().min(1),
  pageNumber: z.number().int().min(1),
  participantId: z.string().min(1).optional(),
});

export const syncWhiteboardPage = createServerFn({ method: "POST" })
  .inputValidator(syncWhiteboardPageSchema)
  .handler(async ({ data }) => {
    const auth = await loadAuthHelpers();
    const env = await auth.getEnv();
    const db = createDb(env.DB);

    // Any active participant may request a page sync — the whiteboard server
    // validates whether the caller holds writer status for the session.
    const { meeting, participantIdentity } = await resolveActiveWhiteboardCallerIdentity(
      db,
      env,
      data.meetingId,
      data.participantId,
      "whiteboard:page-sync",
      auth,
    );

    return callWhiteboardApi(env, "/page/sync", {
      body: { sessionId: `meet-${meeting.id}`, userId: participantIdentity.identity, pageNumber: data.pageNumber },
    });
  });
