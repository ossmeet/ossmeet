import "@tanstack/react-start/server-only";
import { createDb } from "@ossmeet/db";
import type { Database } from "@ossmeet/db";
import { meetingSessions, meetingArtifacts, meetingLivekitPresences, users } from "@ossmeet/db/schema";
import { and, eq } from "drizzle-orm";
import { WebhookReceiver, EgressClient, EgressStatus, RoomServiceClient } from "livekit-server-sdk";
import type { WebhookEvent } from "livekit-server-sdk";
import { getPlanLimits } from "@ossmeet/shared";
import type { PlanType } from "@ossmeet/shared";
import { getEnvFromRequest } from "@/server/auth/helpers";
import { livekitHttpUrl } from "@/lib/meeting/livekit-helpers";
import { logError, logWarn } from "@/lib/logger";
import { withD1Retry } from "@/lib/db-utils";
import { registerMeetingArtifactMetadata } from "@/server/assets/register";
import { getUserStoredBytes } from "@/server/assets/storage";
import { finalizeSession } from "@/server/meetings/session-finalizer";
import { appendMeetingEvent } from "@/server/meetings/runtime-projection";
import { maybePromoteSuccessorHost, type HostPromotionRealtimeServices } from "@/server/meetings/leave-end.server";
import { RequestBodyTooLargeError, readRequestBodyText } from "@/server/request-body";

const MAX_LIVEKIT_WEBHOOK_BODY_BYTES = 1024 * 1024;

interface HandleWebhookEventOptions {
  db?: Database;
  promotionServices?: HostPromotionRealtimeServices;
}

export async function handleLivekitWebhookRequest(request: Request): Promise<Response> {
  const env = await getEnvFromRequest(request);
  if (!env?.LIVEKIT_API_KEY || !env?.LIVEKIT_API_SECRET) {
    return new Response("Service unavailable", { status: 503 });
  }

  let body: string;
  try {
    body = await readRequestBodyText(request, MAX_LIVEKIT_WEBHOOK_BODY_BYTES);
  } catch (err) {
    if (err instanceof RequestBodyTooLargeError) {
      return new Response("Payload too large", { status: 413 });
    }
    throw err;
  }
  const authHeader = request.headers.get("Authorization") ?? undefined;

  const receiver = new WebhookReceiver(env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET);
  let event: WebhookEvent;
  try {
    event = await receiver.receive(body, authHeader);
  } catch {
    return new Response("Unauthorized", { status: 401 });
  }

  try {
    await handleLivekitWebhookEvent(event, env);
  } catch (err) {
    logError("[webhook] Unhandled error:", err);
    return new Response("Webhook processing failed", { status: 500 });
  }

  return new Response("OK", { status: 200 });
}

function isLiveKitParticipantMissingError(err: unknown): boolean {
  if (typeof err !== "object" || err === null) {
    const message = String(err).toLowerCase();
    return message.includes("not found") || message.includes("does not exist");
  }
  const errorLike = err as { status?: unknown; code?: unknown; message?: unknown };
  if (errorLike.status === 404) return true;
  if (typeof errorLike.code === "string" && errorLike.code.toLowerCase() === "not_found") return true;
  const message = typeof errorLike.message === "string" ? errorLike.message.toLowerCase() : "";
  return message.includes("not found") || message.includes("does not exist");
}

export async function handleLivekitWebhookEvent(
  event: WebhookEvent,
  env: Env,
  options: HandleWebhookEventOptions = {},
): Promise<void> {
  const db = options.db ?? createDb(env.DB);
  const roomService = new RoomServiceClient(
    livekitHttpUrl(env.LIVEKIT_URL),
    env.LIVEKIT_API_KEY,
    env.LIVEKIT_API_SECRET,
  );
  const isIdentityStillPresent = async (roomName: string, identity: string) => {
    try {
      await roomService.getParticipant(roomName, identity);
      return true;
    } catch (err) {
      if (isLiveKitParticipantMissingError(err)) return false;
      throw err;
    }
  };

  if (event.event === "participant_joined") {
    const roomName = event.room?.name;
    const identity = event.participant?.identity;
    if (!roomName?.startsWith("meet-") || !identity) return;

    const meetingId = roomName.replace(/^meet-/, "");

    await withD1Retry(() =>
      db
        .update(meetingLivekitPresences)
        .set({
          presenceStatus: "connected",
          livekitParticipantSid: event.participant?.sid ?? null,
          connectedAt: new Date(),
          disconnectedAt: null,
          lastWebhookAt: new Date(),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(meetingLivekitPresences.sessionId, meetingId),
            eq(meetingLivekitPresences.livekitIdentity, identity),
          ),
        )
    ).catch((err) => {
      logError("[webhook] Failed to mark connection as connected:", err);
    });
    await appendMeetingEvent(db, {
      sessionId: meetingId,
      kind: "livekit.participant_joined",
      subjectId: identity,
      payload: {
        livekitParticipantSid: event.participant?.sid ?? null,
      },
    }).catch(() => undefined);
    return;
  }

  if (event.event === "participant_left" || event.event === "participant_connection_aborted") {
    const roomName = event.room?.name;
    const identity = event.participant?.identity;
    if (!roomName?.startsWith("meet-") || !identity) return;

    const meetingId = roomName.replace(/^meet-/, "");
    const eventName = event.event;

    // Webhook delivery can lag the actual disconnect by seconds and may even
    // arrive after the SDK has reconnected the same identity. Marking the row
    // left in that case kicks a connected user on their next token refresh.
    // Verify the identity is actually gone from the LiveKit room before acting.
    try {
      if (await isIdentityStillPresent(roomName, identity)) {
        // Same identity is back in the room — webhook is stale, ignore.
        return;
      }
    } catch (err) {
      // If LiveKit is unreachable the room is likely gone; fall through and
      // mark the row left. The reverse error (false-negative kick) is worse
      // than the false-positive "leave a tombstone" we get if the room dies.
      logWarn(`[webhook] ${eventName} aliveness check failed; proceeding to mark left:`, err);
    }

    await withD1Retry(() =>
      db
        .update(meetingLivekitPresences)
        .set({
          presenceStatus: eventName === "participant_connection_aborted" ? "aborted" : "disconnected",
          disconnectReason: eventName,
          disconnectedAt: new Date(),
          lastWebhookAt: new Date(),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(meetingLivekitPresences.sessionId, meetingId),
            eq(meetingLivekitPresences.livekitIdentity, identity),
          ),
        )
    )
      .catch((err) => {
        logError(`[webhook] Failed to mark connection as left for ${eventName}:`, err);
        return null;
      });
    try {
      if (await isIdentityStillPresent(roomName, identity)) {
        await withD1Retry(() =>
          db
            .update(meetingLivekitPresences)
            .set({ presenceStatus: "connected", disconnectedAt: null, updatedAt: new Date() })
            .where(
              and(
                eq(meetingLivekitPresences.sessionId, meetingId),
                eq(meetingLivekitPresences.livekitIdentity, identity),
              ),
            )
        );
        return;
      }
    } catch (err) {
      logWarn(`[webhook] ${eventName} post-update aliveness check failed:`, err);
    }

    await appendMeetingEvent(db, {
      sessionId: meetingId,
      kind: `livekit.${eventName}`,
      subjectId: identity,
      payload: {
        livekitParticipantSid: event.participant?.sid ?? null,
      },
    }).catch(() => undefined);

    await maybePromoteSuccessorHost(db, meetingId, env, options.promotionServices);

    // Do not finalize the OSSMeet session here. LiveKit can perform a full
    // reconnect after emitting participant_left; the room_finished webhook is
    // the authoritative signal that departure_timeout elapsed with nobody back.
    return;
  }

  // When a room closes, stop any active egress so the egress service
  // gets a clean shutdown signal rather than hanging on a dead room.
  if (event.event === "room_finished") {
    const roomName = event.room?.name;
    if (roomName?.startsWith("meet-")) {
      const meetingId = roomName.replace(/^meet-/, "");
      const meeting = await db.query.meetingSessions.findFirst({
        where: eq(meetingSessions.id, meetingId),
        columns: { id: true, activeEgressId: true, activeStreamEgressId: true },
      });
      const activeEgressIds = [meeting?.activeEgressId, meeting?.activeStreamEgressId]
        .filter((egressId): egressId is string => !!egressId);
      for (const egressId of activeEgressIds) {
        if (egressId.startsWith("__starting__:")) {
          // Room closed while egress was still in the "starting" window.
          // The egress never launched; finalizer clears the sentinel.
        } else {
          const egressClient = new EgressClient(
            livekitHttpUrl(env.LIVEKIT_URL),
            env.LIVEKIT_API_KEY,
            env.LIVEKIT_API_SECRET,
          );
          await egressClient.stopEgress(egressId).catch((err) => {
            logError("[webhook] Failed to stop egress on room_finished:", err);
          });
        }
      }
      if (meeting) {
        await appendMeetingEvent(db, {
          sessionId: meetingId,
          kind: "livekit.room_finished",
          subjectId: roomName,
          payload: null,
        }).catch(() => undefined);
        await finalizeSession(db, {
          meetingId,
          reason: "natural",
          now: new Date(),
          onlyActive: true,
          env,
        }).catch((err) => {
          logError("[webhook] Failed to finalize meeting on room_finished:", err);
        });
      }
    }
    return;
  }

  if (event.event !== "egress_ended") return;

  const egress = event.egressInfo;
  if (!egress?.roomName?.startsWith("meet-")) return;

  const meetingId = egress.roomName.replace(/^meet-/, "");
  const clearActiveEgress = () =>
    egress.egressId
      ? withD1Retry(() =>
          db
            .update(meetingSessions)
            .set({ activeEgressId: null, updatedAt: new Date() })
            .where(
              and(
                eq(meetingSessions.id, meetingId),
                eq(meetingSessions.activeEgressId, egress.egressId),
              ),
            ),
        ).catch((err) => {
          logError("[webhook] Failed to clear ended egress state:", err);
        })
      : Promise.resolve();
  const clearActiveStreamEgress = () =>
    egress.egressId
      ? withD1Retry(() =>
          db
            .update(meetingSessions)
            .set({ activeStreamEgressId: null, updatedAt: new Date() })
            .where(
              and(
                eq(meetingSessions.id, meetingId),
                eq(meetingSessions.activeStreamEgressId, egress.egressId),
              ),
            ),
        ).catch((err) => {
          logError("[webhook] Failed to clear ended stream egress state:", err);
        })
      : Promise.resolve();
  const clearEgressMetadata = () =>
    roomService.updateRoomMetadata(egress.roomName, JSON.stringify({ egressMode: null })).catch((err) => {
      logError("[webhook] Failed to update room metadata after egress ended:", err);
    });

  const activeStream = egress.egressId
    ? await db.query.meetingSessions.findFirst({
        where: and(
          eq(meetingSessions.id, meetingId),
          eq(meetingSessions.activeStreamEgressId, egress.egressId),
        ),
        columns: { id: true },
      })
    : null;
  if (activeStream) {
    if (egress.status !== EgressStatus.EGRESS_COMPLETE) {
      logWarn(
        `[webhook] Stream egress ended without completing ` +
          `(meeting: ${meetingId}, egress: ${egress.egressId}, status: ${egress.status})`,
      );
    }
    await clearActiveStreamEgress();
    await clearEgressMetadata();
    return;
  }

  // stopStreamingTask clears activeStreamEgressId before this webhook arrives.
  // EGRESS_COMPLETE with no file output is streaming-only — recording egresses
  // always produce a file on EGRESS_COMPLETE. Clear metadata defensively in
  // case stopStreamingTask's metadata call lost a race, then return.
  if (egress.status === EgressStatus.EGRESS_COMPLETE && !egress.fileResults.length) {
    await clearEgressMetadata();
    return;
  }

  if (egress.status !== EgressStatus.EGRESS_COMPLETE) {
    logWarn(
      `[webhook] Egress ended without a completed recording ` +
        `(meeting: ${meetingId}, egress: ${egress.egressId}, status: ${egress.status})`,
    );
    await clearActiveEgress();
    await clearEgressMetadata();
    return;
  }

  const fileResult = egress.fileResults[0];
  if (!fileResult?.filename) {
    logWarn(
      `[webhook] Completed egress did not include a file result ` +
        `(meeting: ${meetingId}, egress: ${egress.egressId})`,
    );
    await clearActiveEgress();
    await clearEgressMetadata();
    return;
  }

  const meeting = await db.query.meetingSessions.findFirst({
    where: eq(meetingSessions.id, meetingId),
    columns: { id: true, spaceId: true, hostId: true },
  });
  if (!meeting) return;
  const spaceId = meeting.spaceId;

  const r2Key = fileResult.filename;

  // Idempotency: LiveKit may re-deliver webhooks. If this recording is already
  // registered, skip all quota/R2 logic to avoid deleting a valid asset.
  const alreadyRegistered = await db.query.meetingArtifacts.findFirst({
    where: eq(meetingArtifacts.r2Key, r2Key),
    columns: { id: true },
  });
  if (alreadyRegistered) {
    await clearActiveEgress();
    await clearEgressMetadata();
    return;
  }

  const rawSize = fileResult.size;
  if (typeof rawSize !== "bigint" || rawSize <= 0n) {
    logWarn(`[webhook] Recording has invalid size (${rawSize}), skipping registration`);
    await clearActiveEgress();
    await clearEgressMetadata();
    return;
  }
  if (rawSize > BigInt(Number.MAX_SAFE_INTEGER)) {
    logWarn(`[webhook] Recording size ${rawSize} exceeds safe integer range, skipping`);
    await clearActiveEgress();
    await clearEgressMetadata();
    return;
  }
  const actualSize = Number(rawSize);
  const filename = r2Key.split("/").pop() ?? r2Key;

  const hostUser = await db.query.users.findFirst({
    where: eq(users.id, meeting.hostId),
    columns: { plan: true },
  });
  const limits = getPlanLimits((hostUser?.plan ?? "free") as PlanType);
  if (limits.maxStorageBytes !== null) {
    const usage = await getUserStoredBytes(db, meeting.hostId);
    if (usage + actualSize > limits.maxStorageBytes) {
      logWarn(
        `[webhook] Host ${meeting.hostId} over storage quota — deleting unregistered recording ` +
          `(recording: ${r2Key}, size: ${actualSize})`,
      );
      await env.R2_BUCKET.delete(r2Key).catch((err: unknown) => {
        logError("[webhook] Failed to delete over-quota recording from R2:", err);
      });
      await clearActiveEgress();
      await clearEgressMetadata();
      return;
    }
  }

  try {
    await registerMeetingArtifactMetadata(db, {
      spaceId,
      meetingId: meeting.id,
      type: "recording",
      r2Key,
      filename,
      mimeType: "video/mp4",
      size: actualSize,
      uploadedById: meeting.hostId,
      createdAt: new Date(),
    });
  } catch (err) {
    logError("[webhook] Failed to register recording asset (will be reconciled by daily cleanup):", err);
  }

  await clearActiveEgress();
  await clearEgressMetadata();
}
