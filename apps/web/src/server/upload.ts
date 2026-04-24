import { createServerFn } from "@tanstack/react-start";
import { getEnv, requireAuth, enforceRateLimit, getClientIP, verifyGuestParticipant } from "./auth/helpers";
import { authMiddleware } from "./middleware";
import { AwsClient } from "aws4fetch";
import { z } from "zod";
import { createDb } from "@ossmeet/db";
import { getPlanLimits, Errors, AppError } from "@ossmeet/shared";
import type { PlanType } from "@ossmeet/shared";
import { isValidWhiteboardAssetKeyForMeeting } from "@/lib/whiteboard-asset-key";
import { getUserStoredBytes } from "./assets/storage";
import {
  assertActiveMeetingParticipantWithSpaceAccess,
  assertMeetingExists,
} from "./meetings/access-assertions";

const ALLOWED_MIME_TYPES = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "video/mp4",
  "video/webm",
  "audio/mpeg",
  "audio/wav",
  "audio/webm",
] as const;

// whiteboard uploads only accept images and PDFs — no video/audio
const WHITEBOARD_ALLOWED_MIME_TYPES = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/svg+xml",
  "image/bmp",
  "image/tiff",
  "image/heic",
  "image/avif",
] as const;

const MAX_FILE_SIZE = 100 * 1024 * 1024;
const MAX_WHITEBOARD_FILE_SIZE = 25 * 1024 * 1024;
const MAX_GUEST_WHITEBOARD_FILE_SIZE = 10 * 1024 * 1024;
const MAX_GUEST_WHITEBOARD_PARTICIPANT_BYTES = 50 * 1024 * 1024;
const MAX_R2_LIST_PAGES = 100;

const uploadSchema = z.object({
  filename: z.string().min(1).max(255),
  mimeType: z.string().refine(
    (type): type is typeof ALLOWED_MIME_TYPES[number] => (ALLOWED_MIME_TYPES as readonly string[]).includes(type),
    { message: `Allowed types: ${ALLOWED_MIME_TYPES.join(", ")}` }
  ),
  fileSize: z.number().int().positive().max(MAX_FILE_SIZE),
  r2Key: z
    .string()
    .min(1)
    .max(512)
    .regex(
      /^[a-zA-Z0-9][a-zA-Z0-9_\-/.]{0,510}$/,
      "Invalid r2Key format"
    )
    .refine((key) => !key.includes(".."), "r2Key must not contain '..'"),
  md5Hash: z.string().regex(/^[a-f0-9]{32}$/i, "Invalid MD5 hash").optional(),
});

// separate schema for whiteboard uploads with restricted MIME types
const whiteboardUploadSchema = z.object({
  filename: z.string().min(1).max(255),
  mimeType: z.string().refine(
    (type): type is typeof WHITEBOARD_ALLOWED_MIME_TYPES[number] =>
      (WHITEBOARD_ALLOWED_MIME_TYPES as readonly string[]).includes(type),
    { message: `Whiteboard allowed types: ${WHITEBOARD_ALLOWED_MIME_TYPES.join(", ")}` }
  ),
  fileSize: z.number().int().positive().max(MAX_WHITEBOARD_FILE_SIZE),
  // r2Key must be scoped to wb/{meetingId}/ — enforced at runtime after meetingId is known
  r2Key: z
    .string()
    .min(1)
    .max(512)
    .regex(
      /^[a-zA-Z0-9][a-zA-Z0-9_\-/.]{0,510}$/,
      "Invalid r2Key format"
    )
    .refine((key) => !key.includes(".."), "r2Key must not contain '..'"),
  md5Hash: z.string().regex(/^[a-f0-9]{32}$/i, "Invalid MD5 hash").optional(),
  participantId: z.string().min(1).optional(),
  sessionId: z.string().min(1),
});

/** Instantiate an R2-compatible S3 client with the account's credentials. */
export function buildR2Client(env: Env) {
  return {
    r2: new AwsClient({
      accessKeyId: env.R2_ACCESS_KEY_ID,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    }),
    endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  };
}

async function getR2PrefixStoredBytes(
  bucket: Env["R2_BUCKET"],
  prefix: string,
  stopAtBytes = Number.POSITIVE_INFINITY,
): Promise<number> {
  type R2ListObject = { size: number };
  type R2ListResult = { objects: R2ListObject[]; truncated: boolean; cursor?: string };

  let total = 0;
  let cursor: string | undefined;
  for (let page = 0; page < MAX_R2_LIST_PAGES; page++) {
    const listed = (await bucket.list({
      prefix,
      limit: 1000,
      ...(cursor ? { cursor } : {}),
    })) as R2ListResult;

    for (const object of listed.objects) {
      total += object.size;
      if (total >= stopAtBytes) return total;
    }

    if (!listed.truncated || !listed.cursor) break;
    cursor = listed.cursor;
  }

  return total;
}

export const getPresignedUploadUrl = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator(uploadSchema)
  .handler(async ({ data, context: { user, env, db } }) => {

    await enforceRateLimit(env, `upload:${user.id}`);

    // Enforce per-user storage quota
    const limits = getPlanLimits((user.plan as PlanType) ?? "free");
    if (limits.maxStorageBytes !== null) {
      const usage = await getUserStoredBytes(db, user.id);
      if (usage + data.fileSize > limits.maxStorageBytes) {
        throw Errors.PLAN_LIMIT_REACHED("Storage quota exceeded");
      }
    }

    const safeR2Key = `uploads/${user.id}/${data.r2Key}`;

    const { r2, endpoint } = buildR2Client(env);
    const url = new URL(`/${env.R2_BUCKET_NAME}/${safeR2Key}`, endpoint);
    url.searchParams.set("X-Amz-Expires", "600");

    const headers: Record<string, string> = {
      "Content-Type": data.mimeType,
      "Content-Length": String(data.fileSize),
    };

    // Add checksum validation if provided (prevents corrupted uploads)
    if (data.md5Hash) {
      headers["Content-MD5"] = btoa(
        data.md5Hash.match(/.{2}/g)!.map(byte => String.fromCharCode(parseInt(byte, 16))).join('')
      );
    }

    const signed = await r2.sign(
      new Request(url.toString(), {
        method: "PUT",
        headers,
      }),
      { aws: { signQuery: true } }
    );

    return { uploadUrl: signed.url };
  });

/**
 * Whiteboard-specific upload that supports guest authentication.
 * Guests can upload to whiteboard during meetingSessions using their participantId and HttpOnly guest cookie.
 * Files are stored under uploads/guest-{participantId}/ and capped per guest participant.
 */
export const getWhiteboardUploadUrl = createServerFn({ method: "POST" })
  .inputValidator(whiteboardUploadSchema)
  .handler(async ({ data }) => {
    const env = await getEnv();
    const db = createDb(env.DB);
    
    // Try authenticated user first
    let userId: string;
    
    // r2Key must be scoped to the declared meetingId to prevent cross-meeting path traversal
    if (!isValidWhiteboardAssetKeyForMeeting(data.r2Key, data.sessionId)) {
      throw Errors.FORBIDDEN();
    }

    try {
      const user = await requireAuth();
      userId = user.id;
      await enforceRateLimit(env, `upload:${user.id}`);

      await assertActiveMeetingParticipantWithSpaceAccess(db, data.sessionId, user.id);

      // Enforce plan storage quota for authenticated users, including unsigned
      // whiteboard assets that are stored directly in R2.
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
      }
    } catch (err) {
      // Only treat auth failures as "not authenticated" — rethrow infrastructure errors
      if (!(err instanceof AppError && err.code === "UNAUTHORIZED")) throw err;

      if (!data.participantId || !data.sessionId) throw Errors.UNAUTHORIZED();
      if (data.fileSize > MAX_GUEST_WHITEBOARD_FILE_SIZE) {
        throw Errors.PLAN_LIMIT_REACHED("Guest whiteboard uploads are limited to 10 MB");
      }

      // Uploads only allowed during active meetingSessions
      const meeting = await assertMeetingExists(db, data.sessionId, { requireActive: true });
      if (!meeting) throw Errors.FORBIDDEN();

      await verifyGuestParticipant(db, data.sessionId, data.participantId);
      userId = `guest-${data.participantId}`;

      // Rate limit by IP (prevents bypass by rotating participantId) and by participant
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
        data.md5Hash.match(/.{2}/g)!.map(byte => String.fromCharCode(parseInt(byte, 16))).join('')
      );
    }
    
    const signed = await r2.sign(
      new Request(url.toString(), {
        method: "PUT",
        headers,
      }),
      { aws: { signQuery: true } }
    );
    
    return { uploadUrl: signed.url };
  });
