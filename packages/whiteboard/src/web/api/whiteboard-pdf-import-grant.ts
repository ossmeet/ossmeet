import { createDb } from "@ossmeet/db";
import { users } from "@ossmeet/db/schema";
import { eq } from "drizzle-orm";
import { getPlanLimits } from "@ossmeet/shared";
import type { PlanType } from "@ossmeet/shared";
import { z } from "zod";
import { RequestBodyTooLargeError, readRequestBodyBytes } from "@/server/request-body";
import { getUserStoredBytes } from "@/server/assets/storage";
import { getActiveWhiteboardParticipantAccess } from "../server/meetings/whiteboard-access";
import { timingSafeEqual } from "../../lib/crypto-utils";
import { getR2PrefixStoredBytes } from "../../lib/r2-storage-utils";
import { reserveUploadBytes } from "../server/upload-reservations";
import { assertWhiteboardCanvasEditAccessResponse } from "../server/whiteboard-canvas-access-check";

const MAX_GUEST_WHITEBOARD_PARTICIPANT_BYTES = 50 * 1024 * 1024;
const MAX_GRANT_BODY_BYTES = 16 * 1024;

const importGrantSchema = z.object({
  meetingId: z.string().regex(/^meet-[a-zA-Z0-9_-]+$/),
  connectionId: z.string().min(1),
  participantIdentity: z.string().min(1),
  importId: z.string().regex(/^[0-9a-f-]{36}$/),
  pageCount: z.number().int().positive().max(100),
  totalBytes: z.number().int().positive().max(500 * 1024 * 1024),
}).strict();

export async function handlePdfImportGrant(request: Request, env: Env): Promise<Response> {
  if (!env.WHITEBOARD_INTERNAL_SECRET) {
    return new Response("Not found", { status: 404 });
  }

  const secret = request.headers.get("X-Whiteboard-Secret") ?? "";
  if (!(await timingSafeEqual(secret, env.WHITEBOARD_INTERNAL_SECRET))) {
    return new Response("Unauthorized", { status: 401 });
  }

  let bodyBytes: Uint8Array;
  try {
    bodyBytes = await readRequestBodyBytes(request, MAX_GRANT_BODY_BYTES);
  } catch (err) {
    if (err instanceof RequestBodyTooLargeError) {
      return new Response("Payload too large", { status: 413 });
    }
    throw err;
  }

  let body: unknown;
  try {
    body = JSON.parse(new TextDecoder().decode(bodyBytes));
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const parsed = importGrantSchema.safeParse(body);
  if (!parsed.success) {
    return new Response("Invalid body", { status: 400 });
  }

  const {
    meetingId: meetingSid,
    connectionId,
    participantIdentity,
    importId,
    totalBytes,
  } = parsed.data;
  const meetingId = meetingSid.slice("meet-".length);
  const db = createDb(env.DB);

  const access = await getActiveWhiteboardParticipantAccess(db, meetingId, connectionId);
  if (!access || access.participantIdentity !== participantIdentity) {
    return new Response("Participant not found", { status: 403 });
  }

  const editorAccessError = await assertWhiteboardCanvasEditAccessResponse(env, {
    sessionId: meetingSid,
    userId: participantIdentity,
    role: access.role,
  });
  if (editorAccessError) return editorAccessError;

  let ownerPrefix: string;
  if (access.userId) {
    const user = await db.query.users.findFirst({
      where: eq(users.id, access.userId),
      columns: { id: true, plan: true },
    });
    if (!user) {
      return new Response("User not found", { status: 403 });
    }

    const limits = getPlanLimits((user.plan as PlanType) ?? "free");
    if (limits.maxStorageBytes !== null) {
      const usage = await getUserStoredBytes(db, user.id);
      const whiteboardUsage = await getR2PrefixStoredBytes(
        env.R2_BUCKET,
        `uploads/${user.id}/wb/`,
        Math.max(0, limits.maxStorageBytes - usage) + 1,
      );
      if (usage + whiteboardUsage + totalBytes > limits.maxStorageBytes) {
        return new Response("Storage quota exceeded", { status: 403 });
      }
      try {
        await reserveUploadBytes(db, {
          principal: `user:${user.id}`,
          scope: `whiteboard:${meetingId}`,
          bytes: totalBytes,
          actualUsageBytes: usage + whiteboardUsage,
          limitBytes: limits.maxStorageBytes,
        });
      } catch (reservationError) {
        if (reservationError instanceof Error && reservationError.message === "upload_quota_exceeded") {
          return new Response("Storage quota exceeded", { status: 403 });
        }
        throw reservationError;
      }
    }

    ownerPrefix = user.id;
  } else {
    if (!access.admissionId) {
      return new Response("Participant not found", { status: 403 });
    }
    const guestOwner = `guest-${access.admissionId}`;
    const guestUsage = await getR2PrefixStoredBytes(
      env.R2_BUCKET,
      `uploads/${guestOwner}/wb/${meetingId}/`,
      MAX_GUEST_WHITEBOARD_PARTICIPANT_BYTES + 1,
    );
    if (guestUsage + totalBytes > MAX_GUEST_WHITEBOARD_PARTICIPANT_BYTES) {
      return new Response("Guest whiteboard upload quota exceeded", { status: 403 });
    }
    try {
      await reserveUploadBytes(db, {
        principal: `guest:${access.admissionId}`,
        scope: `whiteboard:${meetingId}`,
        bytes: totalBytes,
        actualUsageBytes: guestUsage,
        limitBytes: MAX_GUEST_WHITEBOARD_PARTICIPANT_BYTES,
      });
    } catch (reservationError) {
      if (reservationError instanceof Error && reservationError.message === "upload_quota_exceeded") {
        return new Response("Guest whiteboard upload quota exceeded", { status: 403 });
      }
      throw reservationError;
    }
    ownerPrefix = guestOwner;
  }

  return Response.json({
    uploadPrefix: `uploads/${ownerPrefix}/wb/${meetingId}/pdf-imports/${importId}/`,
  });
}
