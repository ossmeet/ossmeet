import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { createDb, type Database } from "@ossmeet/db";
import {
  meetingSessions,
  meetingAdmissions,
} from "@ossmeet/db/schema";
import { eq } from "drizzle-orm";
import {
  saveWhiteboardSnapshotSchema,
  Errors,
  AppError,
} from "@ossmeet/shared";
import { createWhiteboardJWT } from "../../../lib/whiteboard-jwt";
import { setWhiteboardAssetCookie } from "../../lib/whiteboard-cookies.ts";
import { whiteboardSnapshotKey } from "@/lib/r2-key";
import { logError, logWarn } from "@/lib/logger";
import { buildR2Client } from "@/server/upload";
import { withD1Retry } from "@/lib/db-utils";
import {
  assertActiveMeetingParticipantWithSpaceAccess,
  assertMeetingExists,
} from "@/server/meetings/access-assertions";
import {
  findWhiteboardEligiblePresenceByConnectionId,
} from "@/server/meetings/presence-queries";
import { registerMeetingArtifactMetadata } from "@/server/assets/register";

const AUTH_HELPERS_MODULE = "@/server/auth/helpers";
const loadAuthHelpers = () => import(/* @vite-ignore */ AUTH_HELPERS_MODULE);
type AuthHelpers = Awaited<ReturnType<typeof loadAuthHelpers>>;

const WHITEBOARD_TIMEOUT_MS = 6_000;

function getWhiteboardBaseUrls(env: Env): string[] {
  const bases = [env.WHITEBOARD_URL]
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

type WhiteboardApiResponse = {
  success: boolean;
  status?: string;
  editorUserIds?: string[];
  writerUserIds?: string[];
  actingManagerId?: string | null;
  promotedHostId?: string | null;
  navigationControllerUserId?: string | null;
  presenterUserId?: string | null;
  navigationControllerName?: string | null;
  presenterName?: string | null;
  aiPanelOpen?: boolean;
  connectedUsers?: Array<{ userId: string; userName: string }>;
  pendingEditorRequests?: Array<{ userId: string; userName: string }>;
  pendingRequests?: Array<{ userId: string; userName: string }>;
  pageNumber?: number;
};

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

async function resolveAuthenticatedCallerIdentity(
  db: Database,
  meetingId: string,
  userId: string,
  connectionId?: string,
) {
  if (!connectionId) throw Errors.UNAUTHORIZED();

  const presence = await findWhiteboardEligiblePresenceByConnectionId(db, meetingId, connectionId);
  if (!presence || presence.userId !== userId) throw Errors.FORBIDDEN();

  const participant = presence.admissionId
    ? await db.query.meetingAdmissions.findFirst({
        where: eq(meetingAdmissions.id, presence.admissionId),
      })
    : null;

  return {
    connectionId: presence.connectionId,
    identity: presence.livekitIdentity,
    displayName: participant?.displayName ?? "User",
  };
}

async function resolveGuestCallerIdentity(
  db: Database,
  meetingId: string,
  connectionId: string | undefined,
  getGuestCookieSecret: (admissionId: string) => string | null,
  verifyGuestAdmissionBySecret: AuthHelpers["verifyGuestAdmissionBySecret"],
) {
  if (!connectionId) throw Errors.UNAUTHORIZED();

  const presence = await findWhiteboardEligiblePresenceByConnectionId(db, meetingId, connectionId);
  if (!presence || presence.userId !== null || !presence.admissionId) {
    throw Errors.FORBIDDEN();
  }

  const guestSecretHash = getGuestCookieSecret(presence.admissionId);
  await verifyGuestAdmissionBySecret(db, meetingId, presence.admissionId, guestSecretHash);

  return {
    connectionId: presence.connectionId,
    identity: presence.livekitIdentity,
    displayName: "Guest",
  };
}

async function resolveActiveWhiteboardCallerIdentity(
  db: Database,
  env: Env,
  meetingId: string,
  connectionId: string | undefined,
  rateLimitPrefix: string,
  auth: Pick<
    AuthHelpers,
    "getClientIP" | "requireAuth" | "enforceRateLimit"
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
    const callerIdentity = await resolveAuthenticatedCallerIdentity(
      db,
      meeting.id,
      user.id,
      connectionId,
    );
    return { meeting, callerIdentity };
  }

  const authHelpers = await loadAuthHelpers();
  await auth.enforceRateLimit(env, `${rateLimitPrefix}:guest:${connectionId ?? "unknown"}`);
  await auth.enforceRateLimit(env, `${rateLimitPrefix}:ip:${auth.getClientIP()}`);
  const callerIdentity = await resolveGuestCallerIdentity(
    db,
    meeting.id,
    connectionId,
    authHelpers.getGuestCookieSecret,
    authHelpers.verifyGuestAdmissionBySecret,
  );
  return { meeting, callerIdentity };
}

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

  let lastError: Error | null = null;
  for (const baseUrl of baseUrls) {
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
        if (response.status === 401) throw Errors.UNAUTHORIZED();
        if (response.status === 403) throw Errors.FORBIDDEN();
        if (response.status === 404) throw Errors.NOT_FOUND();
        throw Errors.VALIDATION(`Whiteboard request failed (${response.status})`);
      }

      const contentType = response.headers.get("Content-Type") ?? "";
      if (contentType.includes("application/json")) {
        const data = await response.json();
        if (data && typeof data === "object" && !Array.isArray(data)) {
          const record = data as Record<string, unknown>;
          const writerUserIds = Array.isArray(record.writerUserIds)
            ? record.writerUserIds.filter((value): value is string => typeof value === "string")
            : undefined;
          const editorUserIds = Array.isArray(record.editorUserIds)
            ? record.editorUserIds.filter((value): value is string => typeof value === "string")
            : writerUserIds;
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
          const pendingEditorRequests = Array.isArray(record.pendingEditorRequests)
            ? record.pendingEditorRequests.filter(
                (value): value is { userId: string; userName: string } =>
                  !!value &&
                  typeof value === "object" &&
                  typeof (value as { userId?: unknown }).userId === "string" &&
                  typeof (value as { userName?: unknown }).userName === "string"
              )
            : pendingRequests;
          const actingManagerId =
            typeof record.actingManagerId === "string" || record.actingManagerId === null
              ? record.actingManagerId
              : typeof record.promotedHostId === "string" || record.promotedHostId === null
                ? record.promotedHostId
                : undefined;
          const navigationControllerUserId =
            typeof record.navigationControllerUserId === "string" || record.navigationControllerUserId === null
              ? record.navigationControllerUserId
              : typeof record.presenterUserId === "string" || record.presenterUserId === null
                ? record.presenterUserId
                : undefined;
          const navigationControllerName =
            typeof record.navigationControllerName === "string" || record.navigationControllerName === null
              ? record.navigationControllerName
              : typeof record.presenterName === "string" || record.presenterName === null
                ? record.presenterName
                : undefined;

          return {
            success: typeof record.success === "boolean" ? record.success : true,
            status: typeof record.status === "string" ? record.status : undefined,
            editorUserIds,
            writerUserIds: editorUserIds,
            actingManagerId,
            promotedHostId: actingManagerId,
            navigationControllerUserId,
            presenterUserId: navigationControllerUserId,
            navigationControllerName,
            presenterName: navigationControllerName,
            aiPanelOpen: typeof record.aiPanelOpen === "boolean" ? record.aiPanelOpen : undefined,
            connectedUsers,
            pendingEditorRequests,
            pendingRequests: pendingEditorRequests,
            pageNumber: typeof record.pageNumber === "number" ? record.pageNumber : undefined,
          };
        }
        return { success: true };
      }
      return { success: true };
    } catch (err) {
      if (err instanceof AppError && err.statusCode < 500) throw err;
      const callError = err instanceof Error ? err : new Error(String(err));
      lastError = callError;
      logWarn("[whiteboard] endpoint unavailable", { baseUrl, path, method }, callError);
    }
  }
  if (lastError) {
    logWarn("[whiteboard] all endpoints unavailable", { path, method }, lastError);
  }
  throw new AppError("WHITEBOARD_UNAVAILABLE", "Whiteboard service unavailable", 503);
}

const getWhiteboardTokenSchema = z.object({
  meetingId: z.string().min(1),
  connectionId: z.string().min(1).optional(),
});

export const getWhiteboardToken = createServerFn({ method: "POST" })
  .inputValidator(getWhiteboardTokenSchema)
  .handler(async ({ data }) => {
    const { getEnv, getClientIP, requireAuth, enforceRateLimit } =
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
      if (!(err instanceof AppError && err.code === "UNAUTHORIZED")) throw err;
    }

    await enforceRateLimit(
      env,
      userId
        ? `whiteboard:token:${userId}`
        : data.connectionId
          ? `whiteboard:token:guest:${data.connectionId}`
          : `whiteboard:token:guest:${clientIP}`
    );

    if (!isWhiteboardConfigured(env) || !env.WHITEBOARD_JWT_SECRET) {
      throw Errors.CONFIG_ERROR("Whiteboard not configured");
    }

    const meeting = await assertMeetingExists(db, data.meetingId, { requireActive: true });

    if (userId) {
      await assertActiveMeetingParticipantWithSpaceAccess(db, meeting.id, userId);
      const callerIdentity = await resolveAuthenticatedCallerIdentity(
        db,
        meeting.id,
        userId,
        data.connectionId
      );

      const isHost = meeting.hostId === userId;
      const token = await createWhiteboardJWT(env.WHITEBOARD_JWT_SECRET, {
        sub: callerIdentity.identity,
        name: callerIdentity.displayName || userName || "User",
        role: isHost ? "host" : "participant",
        sid: `meet-${meeting.id}`,
        connectionId: callerIdentity.connectionId,
      });

      setWhiteboardAssetCookie(meeting.id, token, {
        appUrl: env.APP_URL,
        environment: env.ENVIRONMENT,
      });

      return { token, whiteboardUrl: getPrimaryWhiteboardUrl(env) };
    }

    const { getGuestCookieSecret, verifyGuestAdmissionBySecret } = await loadAuthHelpers();
    const guestIdentity = await resolveGuestCallerIdentity(
      db,
      meeting.id,
      data.connectionId,
      getGuestCookieSecret,
      verifyGuestAdmissionBySecret,
    );

    const token = await createWhiteboardJWT(env.WHITEBOARD_JWT_SECRET, {
      sub: guestIdentity.identity,
      name: guestIdentity.displayName,
      role: "guest",
      sid: `meet-${meeting.id}`,
      connectionId: guestIdentity.connectionId,
    });

    setWhiteboardAssetCookie(meeting.id, token, {
      appUrl: env.APP_URL,
      environment: env.ENVIRONMENT,
    });

    return { token, whiteboardUrl: getPrimaryWhiteboardUrl(env) };
  });

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
      let snapshotSize = 0;
      try {
        const r2Object = await env.R2_BUCKET.head(data.r2Key);
        if (r2Object) snapshotSize = r2Object.size;
      } catch {
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

const requestWhiteboardEditAccessSchema = z.object({
  meetingId: z.string().min(1),
  connectionId: z.string().min(1).optional(),
});

export const requestWhiteboardEditAccess = createServerFn({ method: "POST" })
  .inputValidator(requestWhiteboardEditAccessSchema)
  .handler(async ({ data }) => {
    const { getEnv, getClientIP, requireAuth, enforceRateLimit } =
      await loadAuthHelpers();
    const env = await getEnv();
    const db = createDb(env.DB);
    const clientIP = getClientIP();
    let meetingRole: "host" | "participant" | "guest" = "participant";

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
        ? `whiteboard:edit-access-request:${userId}`
        : `whiteboard:edit-access-request:guest:${clientIP}`
    );

    if (!isWhiteboardConfigured(env)) {
      throw Errors.CONFIG_ERROR("Whiteboard not configured");
    }

    const meeting = await assertMeetingExists(db, data.meetingId, { requireActive: true });

    if (userId) {
      await assertActiveMeetingParticipantWithSpaceAccess(db, meeting.id, userId);
      const callerIdentity = await resolveAuthenticatedCallerIdentity(
        db,
        meeting.id,
        userId,
        data.connectionId
      );

      meetingRole = meeting.hostId === userId ? "host" : "participant";
      userId = callerIdentity.identity;
      userName = callerIdentity.displayName || userName;
    } else {
      const { getGuestCookieSecret, verifyGuestAdmissionBySecret } = await loadAuthHelpers();
      const guestIdentity = await resolveGuestCallerIdentity(
        db,
        meeting.id,
        data.connectionId,
        getGuestCookieSecret,
        verifyGuestAdmissionBySecret,
      );
      userId = guestIdentity.identity;
      userName = guestIdentity.displayName;
      meetingRole = "guest";
    }

    return callWhiteboardApi(env, "/access/request", {
      body: { sessionId: `meet-${meeting.id}`, userId, userName, role: meetingRole },
    });
  });

const grantWhiteboardEditAccessSchema = z.object({
  meetingId: z.string().min(1),
  targetUserId: z.string().min(1),
  connectionId: z.string().min(1).optional(),
});

export const grantWhiteboardEditAccess = createServerFn({ method: "POST" })
  .inputValidator(grantWhiteboardEditAccessSchema)
  .handler(async ({ data }) => {
    const auth = await loadAuthHelpers();
    const env = await auth.getEnv();
    const db = createDb(env.DB);
    const { meeting, callerIdentity } = await resolveActiveWhiteboardCallerIdentity(
      db,
      env,
      data.meetingId,
      data.connectionId,
      "whiteboard:edit-access-grant",
      auth,
    );

    return callWhiteboardApi(env, "/access/approve", {
      body: {
        sessionId: `meet-${meeting.id}`,
        targetUserId: data.targetUserId,
        approverId: callerIdentity.identity,
      },
    });
  });

const denyWhiteboardEditAccessSchema = z.object({
  meetingId: z.string().min(1),
  targetUserId: z.string().min(1),
  connectionId: z.string().min(1).optional(),
});

export const denyWhiteboardEditAccess = createServerFn({ method: "POST" })
  .inputValidator(denyWhiteboardEditAccessSchema)
  .handler(async ({ data }) => {
    const auth = await loadAuthHelpers();
    const env = await auth.getEnv();
    const db = createDb(env.DB);
    const { meeting, callerIdentity } = await resolveActiveWhiteboardCallerIdentity(
      db,
      env,
      data.meetingId,
      data.connectionId,
      "whiteboard:edit-access-deny",
      auth,
    );

    return callWhiteboardApi(env, "/access/deny", {
      body: {
        sessionId: `meet-${meeting.id}`,
        targetUserId: data.targetUserId,
        approverId: callerIdentity.identity,
      },
    });
  });

const getWhiteboardStateSchema = z.object({
  meetingId: z.string().min(1),
  connectionId: z.string().min(1).optional(),
});

export const getWhiteboardState = createServerFn({ method: "POST" })
  .inputValidator(getWhiteboardStateSchema)
  .handler(async ({ data }) => {
    const auth = await loadAuthHelpers();
    const env = await auth.getEnv();
    const db = createDb(env.DB);
    const { meeting, callerIdentity } = await resolveActiveWhiteboardCallerIdentity(
      db,
      env,
      data.meetingId,
      data.connectionId,
      "whiteboard:state",
      auth,
    );

    return callWhiteboardApi(
      env,
      `/state/meet-${meeting.id}?requesterId=${encodeURIComponent(callerIdentity.identity)}`,
      { method: "GET" },
    );
  });

const setWhiteboardNavigationControllerSchema = z.object({
  meetingId: z.string().min(1),
  targetUserId: z.string().min(1),
  connectionId: z.string().min(1).optional(),
});

export const setWhiteboardNavigationController = createServerFn({ method: "POST" })
  .inputValidator(setWhiteboardNavigationControllerSchema)
  .handler(async ({ data }) => {
    const auth = await loadAuthHelpers();
    const env = await auth.getEnv();
    const db = createDb(env.DB);
    const { meeting, callerIdentity } = await resolveActiveWhiteboardCallerIdentity(
      db,
      env,
      data.meetingId,
      data.connectionId,
      "whiteboard:navigation-controller-set",
      auth,
    );

    return callWhiteboardApi(env, "/navigation-controller/set", {
      body: {
        sessionId: `meet-${meeting.id}`,
        targetUserId: data.targetUserId,
        approverId: callerIdentity.identity,
      },
    });
  });

const releaseWhiteboardNavigationControllerSchema = z.object({
  meetingId: z.string().min(1),
  connectionId: z.string().min(1).optional(),
});

export const releaseWhiteboardNavigationController = createServerFn({ method: "POST" })
  .inputValidator(releaseWhiteboardNavigationControllerSchema)
  .handler(async ({ data }) => {
    const auth = await loadAuthHelpers();
    const env = await auth.getEnv();
    const db = createDb(env.DB);
    const { meeting, callerIdentity } = await resolveActiveWhiteboardCallerIdentity(
      db,
      env,
      data.meetingId,
      data.connectionId,
      "whiteboard:navigation-controller-release",
      auth,
    );

    return callWhiteboardApi(env, "/navigation-controller/release", {
      body: { sessionId: `meet-${meeting.id}`, requesterId: callerIdentity.identity },
    });
  });

const syncWhiteboardPageSchema = z.object({
  meetingId: z.string().min(1),
  pageNumber: z.number().int().min(1),
  connectionId: z.string().min(1).optional(),
});

export const syncWhiteboardPage = createServerFn({ method: "POST" })
  .inputValidator(syncWhiteboardPageSchema)
  .handler(async ({ data }) => {
    const auth = await loadAuthHelpers();
    const env = await auth.getEnv();
    const db = createDb(env.DB);

    const { meeting, callerIdentity } = await resolveActiveWhiteboardCallerIdentity(
      db,
      env,
      data.meetingId,
      data.connectionId,
      "whiteboard:page-sync",
      auth,
    );

    return callWhiteboardApi(env, "/page/sync", {
      body: {
        sessionId: `meet-${meeting.id}`,
        userId: callerIdentity.identity,
        connectionId: callerIdentity.connectionId,
        pageNumber: data.pageNumber,
      },
    });
  });

// Backward-compatible names for callers that have not yet moved from
// "writer/presenter" vocabulary to explicit capabilities.
export const requestWhiteboardWrite = requestWhiteboardEditAccess;
export const approveWhiteboardWrite = grantWhiteboardEditAccess;
export const denyWhiteboardWrite = denyWhiteboardEditAccess;
export const setWhiteboardPresenter = setWhiteboardNavigationController;
export const releaseWhiteboardPresenter = releaseWhiteboardNavigationController;
