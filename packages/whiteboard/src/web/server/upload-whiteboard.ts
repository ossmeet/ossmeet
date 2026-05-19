import { createDb } from "@ossmeet/db";
import { createServerFn } from "@tanstack/react-start";
import { AppError, Errors, getPlanLimits } from "@ossmeet/shared";
import type { PlanType } from "@ossmeet/shared";
import { z } from "zod";

import {
  enforceRateLimit,
  getClientIP,
  getEnv,
  getGuestCookieSecret,
  requireAuth,
  verifyGuestAdmissionBySecret,
} from "@/server/auth/helpers";
import { buildR2Client } from "@/server/upload";
import { getUserStoredBytes } from "@/server/assets/storage";
import {
  assertActiveMeetingParticipantWithSpaceAccess,
  assertMeetingExists,
} from "@/server/meetings/access-assertions";
import { getActiveWhiteboardParticipantAccess } from "./meetings/whiteboard-access";
import {
  buildWhiteboardAssetApiPath,
  extractMeetingIdFromWhiteboardUploadKey,
  extractWhiteboardAssetKeyFromViewerUrl,
  isValidWhiteboardAssetKeyForMeeting,
} from "../../lib/whiteboard-asset-key";
import { getR2PrefixStoredBytes } from "../../lib/r2-storage-utils";
import { reserveUploadBytes } from "./upload-reservations";
import { checkWhiteboardCanvasEditAccess } from "./whiteboard-canvas-access-check";

const WHITEBOARD_ALLOWED_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
] as const;

const MAX_WHITEBOARD_FILE_SIZE = 25 * 1024 * 1024;
const MAX_GUEST_WHITEBOARD_FILE_SIZE = 10 * 1024 * 1024;
const MAX_GUEST_WHITEBOARD_PARTICIPANT_BYTES = 50 * 1024 * 1024;

const whiteboardUploadSchema = z.object({
  filename: z.string().min(1).max(255),
  mimeType: z.string().refine(
    (type): type is (typeof WHITEBOARD_ALLOWED_MIME_TYPES)[number] =>
      (WHITEBOARD_ALLOWED_MIME_TYPES as readonly string[]).includes(type),
    { message: `Whiteboard allowed types: ${WHITEBOARD_ALLOWED_MIME_TYPES.join(", ")}` },
  ),
  fileSize: z.number().int().positive().max(MAX_WHITEBOARD_FILE_SIZE),
  r2Key: z
    .string()
    .min(1)
    .max(512)
    .regex(/^[a-zA-Z0-9][a-zA-Z0-9_\-/.]{0,510}$/, "Invalid r2Key format")
    .refine((key) => !key.includes(".."), "r2Key must not contain '..'"),
  md5Hash: z.string().regex(/^[a-f0-9]{32}$/i, "Invalid MD5 hash").optional(),
  connectionId: z.string().min(1).optional(),
  sessionId: z.string().min(1),
});

async function assertWhiteboardCanvasEditor(
  env: Env,
  input: {
    sessionId: string;
    userId: string;
    role: "host" | "participant" | "guest";
  },
): Promise<void> {
  const result = await checkWhiteboardCanvasEditAccess(env, input);
  if (result.canEditCanvas) return;
  if (result.status === 503) {
    throw new AppError("WHITEBOARD_UNAVAILABLE", "Whiteboard service unavailable", 503);
  }
  throw Errors.FORBIDDEN("Whiteboard edit access is required");
}

export const getWhiteboardUploadUrl = createServerFn({ method: "POST" })
  .inputValidator(whiteboardUploadSchema)
  .handler(async ({ data }) => {
    const env = await getEnv();
    const db = createDb(env.DB);

    let userId: string;

    if (!isValidWhiteboardAssetKeyForMeeting(data.r2Key, data.sessionId)) {
      throw Errors.FORBIDDEN();
    }

    try {
      const user = await requireAuth();
      userId = user.id;
      if (!data.connectionId) throw Errors.UNAUTHORIZED();
      await enforceRateLimit(env, `upload:${user.id}`);

      const meeting = await assertMeetingExists(db, data.sessionId, { requireActive: true });
      await assertActiveMeetingParticipantWithSpaceAccess(db, data.sessionId, user.id);
      const access = await getActiveWhiteboardParticipantAccess(db, data.sessionId, data.connectionId);
      if (!access || access.userId !== user.id) throw Errors.FORBIDDEN();
      await assertWhiteboardCanvasEditor(env, {
        sessionId: data.sessionId,
        userId: access.participantIdentity,
        role: access.userId === meeting.hostId ? "host" : "participant",
      });

      const limits = getPlanLimits((user.plan as PlanType) ?? "free");
      if (limits.maxStorageBytes !== null) {
        const usage = await getUserStoredBytes(db, user.id);
        const whiteboardUsage = await getR2PrefixStoredBytes(
          env.R2_BUCKET,
          `uploads/${user.id}/wb/`,
          Math.max(0, limits.maxStorageBytes - usage) + 1,
        );
        if (usage + whiteboardUsage + data.fileSize > limits.maxStorageBytes) {
          throw Errors.PLAN_LIMIT_REACHED("Storage quota exceeded");
        }
        try {
          await reserveUploadBytes(db, {
            principal: `user:${user.id}`,
            scope: `whiteboard:${data.sessionId}`,
            bytes: data.fileSize,
            actualUsageBytes: usage + whiteboardUsage,
            limitBytes: limits.maxStorageBytes,
          });
        } catch (reservationError) {
          if (reservationError instanceof Error && reservationError.message === "upload_quota_exceeded") {
            throw Errors.PLAN_LIMIT_REACHED("Storage quota exceeded");
          }
          throw reservationError;
        }
      }
    } catch (err) {
      if (!(err instanceof AppError && err.code === "UNAUTHORIZED")) throw err;

      if (!data.connectionId || !data.sessionId) throw Errors.UNAUTHORIZED();
      if (data.fileSize > MAX_GUEST_WHITEBOARD_FILE_SIZE) {
        throw Errors.PLAN_LIMIT_REACHED("Guest whiteboard uploads are limited to 10 MB");
      }

      const meeting = await assertMeetingExists(db, data.sessionId, { requireActive: true });
      if (!meeting) throw Errors.FORBIDDEN();

      const access = await getActiveWhiteboardParticipantAccess(db, data.sessionId, data.connectionId);
      if (!access || access.userId !== null || !access.admissionId) throw Errors.FORBIDDEN();
      await verifyGuestAdmissionBySecret(
        db,
        data.sessionId,
        access.admissionId,
        getGuestCookieSecret(access.admissionId),
      );
      await assertWhiteboardCanvasEditor(env, {
        sessionId: data.sessionId,
        userId: access.participantIdentity,
        role: "guest",
      });
      userId = `guest-${access.admissionId}`;

      await enforceRateLimit(env, `upload:ip:${getClientIP()}`);
      await enforceRateLimit(env, `upload:${userId}`);

      const guestUsage = await getR2PrefixStoredBytes(
        env.R2_BUCKET,
        `uploads/${userId}/wb/${data.sessionId}/`,
        MAX_GUEST_WHITEBOARD_PARTICIPANT_BYTES + 1,
      );
      if (guestUsage + data.fileSize > MAX_GUEST_WHITEBOARD_PARTICIPANT_BYTES) {
        throw Errors.PLAN_LIMIT_REACHED("Guest whiteboard upload quota exceeded");
      }
      try {
        await reserveUploadBytes(db, {
          principal: `guest:${access.admissionId}`,
          scope: `whiteboard:${data.sessionId}`,
          bytes: data.fileSize,
          actualUsageBytes: guestUsage,
          limitBytes: MAX_GUEST_WHITEBOARD_PARTICIPANT_BYTES,
        });
      } catch (reservationError) {
        if (reservationError instanceof Error && reservationError.message === "upload_quota_exceeded") {
          throw Errors.PLAN_LIMIT_REACHED("Guest whiteboard upload quota exceeded");
        }
        throw reservationError;
      }
    }

    const safeR2Key = `uploads/${userId}/${data.r2Key}`;

    const { r2, endpoint } = buildR2Client(env);
    const url = new URL(`/${env.R2_BUCKET_NAME}/${safeR2Key}`, endpoint);
    url.searchParams.set("X-Amz-Expires", "600");

    const headers: Record<string, string> = {
      "Content-Type": data.mimeType,
      "Content-Length": String(data.fileSize),
    };

    if (data.md5Hash) {
      headers["Content-MD5"] = btoa(
        data.md5Hash.match(/.{2}/g)!.map((byte) => String.fromCharCode(parseInt(byte, 16))).join(""),
      );
    }

    const signed = await r2.sign(
      new Request(url.toString(), {
        method: "PUT",
        headers,
      }),
      { aws: { signQuery: true } },
    );

    return {
      uploadUrl: signed.url,
      assetUrl: buildWhiteboardAssetApiPath(safeR2Key),
    };
  });

const deleteWhiteboardAssetSchema = z.object({
  assetUrl: z.string().min(1).max(2048),
  connectionId: z.string().min(1).optional(),
  sessionId: z.string().min(1),
});

export const deleteWhiteboardAsset = createServerFn({ method: "POST" })
  .inputValidator(deleteWhiteboardAssetSchema)
  .handler(async ({ data }) => {
    const env = await getEnv();
    const db = createDb(env.DB);
    const r2Key = extractWhiteboardAssetKeyFromViewerUrl(data.assetUrl);
    let ownerPrefix: string | null = null;

    if (!r2Key) throw Errors.FORBIDDEN();
    if (extractMeetingIdFromWhiteboardUploadKey(r2Key) !== data.sessionId) {
      throw Errors.FORBIDDEN();
    }

    try {
      const user = await requireAuth();
      await enforceRateLimit(env, `whiteboard:asset-delete:${user.id}`);
      if (!data.connectionId) throw Errors.UNAUTHORIZED();
      const meeting = await assertMeetingExists(db, data.sessionId, { requireActive: true });
      await assertActiveMeetingParticipantWithSpaceAccess(db, data.sessionId, user.id);
      const access = await getActiveWhiteboardParticipantAccess(db, data.sessionId, data.connectionId);
      if (!access || access.userId !== user.id) throw Errors.FORBIDDEN();
      ownerPrefix = `uploads/${user.id}/`;
      await assertWhiteboardCanvasEditor(env, {
        sessionId: data.sessionId,
        userId: access.participantIdentity,
        role: access.userId === meeting.hostId ? "host" : "participant",
      });
    } catch (err) {
      if (!(err instanceof AppError && err.code === "UNAUTHORIZED")) throw err;

      if (!data.connectionId) throw Errors.UNAUTHORIZED();
      await enforceRateLimit(env, `whiteboard:asset-delete:ip:${getClientIP()}`);
      await enforceRateLimit(env, `whiteboard:asset-delete:guest:${data.connectionId}`);

      const meeting = await assertMeetingExists(db, data.sessionId, { requireActive: true });
      if (!meeting) throw Errors.FORBIDDEN();

      const access = await getActiveWhiteboardParticipantAccess(db, data.sessionId, data.connectionId);
      if (!access || access.userId !== null || !access.admissionId) throw Errors.FORBIDDEN();
      ownerPrefix = `uploads/guest-${access.admissionId}/`;
      await verifyGuestAdmissionBySecret(
        db,
        data.sessionId,
        access.admissionId,
        getGuestCookieSecret(access.admissionId),
      );
      await assertWhiteboardCanvasEditor(env, {
        sessionId: data.sessionId,
        userId: access.participantIdentity,
        role: "guest",
      });
    }

    if (!ownerPrefix || !r2Key.startsWith(ownerPrefix)) {
      return { success: true, deleted: false };
    }

    await env.R2_BUCKET.delete(r2Key);
    return { success: true, deleted: true };
  });
