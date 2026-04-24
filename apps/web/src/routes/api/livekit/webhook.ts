import { createFileRoute } from "@tanstack/react-router";
import { createDb } from "@ossmeet/db";
import { meetingSessions, meetingArtifacts, meetingParticipants, users } from "@ossmeet/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { WebhookReceiver, EgressClient, EgressStatus, RoomServiceClient } from "livekit-server-sdk";
import type { WebhookEvent } from "livekit-server-sdk";
import { CURRENT_MEETING_PARTICIPANT_STATUSES, getPlanLimits } from "@ossmeet/shared";
import type { PlanType } from "@ossmeet/shared";
import { getEnvFromRequest } from "@/server/auth/helpers";
import { livekitHttpUrl } from "@/lib/meeting/livekit-helpers";
import { logError, logWarn } from "@/lib/logger";
import { withD1Retry } from "@/lib/db-utils";
import { registerMeetingArtifactMetadata } from "@/server/assets/register";
import { getUserStoredBytes } from "@/server/assets/storage";
import { finalizeSessionByMeetingId } from "@/server/meetings/session-finalizer";

/**
 * LiveKit webhook receiver.
 * On egress_ended with EGRESS_COMPLETE, registers the recording file as a
 * meeting artifact so it appears in the space's Assets panel.
 *
 * LiveKit sends webhooks with an Authorization header containing a signed JWT.
 * Configure the webhook URL in your LiveKit project/server settings:
 *   https://your-app.com/api/livekit/webhook
 */
export const Route = createFileRoute("/api/livekit/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const env = await getEnvFromRequest(request);
        if (!env?.LIVEKIT_API_KEY || !env?.LIVEKIT_API_SECRET) {
          return new Response("Service unavailable", { status: 503 });
        }

        const body = await request.text();
        const authHeader = request.headers.get("Authorization") ?? undefined;

        const receiver = new WebhookReceiver(env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET);
        let event: WebhookEvent;
        try {
          event = await receiver.receive(body, authHeader);
        } catch {
          return new Response("Unauthorized", { status: 401 });
        }

        // Respond to LiveKit immediately after JWT verification — all DB work is
        // deferred via waitUntil so LiveKit's timeout never blocks our processing.
        const ctx = (request as unknown as { __cloudflare?: { ctx?: ExecutionContext } })
          .__cloudflare?.ctx;

        const work = handleWebhookEvent(event, env).catch((err) => {
          logError("[webhook] Unhandled error:", err);
        });

        if (ctx) {
          ctx.waitUntil(work);
        } else {
          await work;
        }

        return new Response("OK", { status: 200 });
      },
    },
  },
});

async function handleWebhookEvent(event: WebhookEvent, env: Env): Promise<void> {
  if (event.event === "participant_joined") {
    const roomName = event.room?.name;
    const identity = event.participant?.identity;
    if (!roomName?.startsWith("meet-") || !identity) return;

    const meetingId = roomName.replace(/^meet-/, "");
    const db = createDb(env.DB);

    await withD1Retry(() =>
      db
        .update(meetingParticipants)
        .set({ status: "active" })
        .where(
          and(
            eq(meetingParticipants.sessionId, meetingId),
            eq(meetingParticipants.livekitIdentity, identity),
            inArray(meetingParticipants.status, CURRENT_MEETING_PARTICIPANT_STATUSES),
          ),
        )
    ).catch((err) => {
      logError("[webhook] Failed to mark participant as active:", err);
    });
    return;
  }

  if (event.event === "participant_left" || event.event === "participant_connection_aborted") {
    const roomName = event.room?.name;
    const identity = event.participant?.identity;
    if (!roomName?.startsWith("meet-") || !identity) return;

    const meetingId = roomName.replace(/^meet-/, "");
    const db = createDb(env.DB);
    const eventName = event.event;

    // Webhook delivery can lag the actual disconnect by seconds and may even
    // arrive after the SDK has reconnected the same identity. Marking the row
    // left in that case kicks a connected user on their next token refresh.
    // Verify the identity is actually gone from the LiveKit room before acting.
    try {
      const roomService = new RoomServiceClient(
        livekitHttpUrl(env.LIVEKIT_URL),
        env.LIVEKIT_API_KEY,
        env.LIVEKIT_API_SECRET,
      );
      const participants = await roomService.listParticipants(roomName);
      if (participants.some((p) => p.identity === identity)) {
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
        .update(meetingParticipants)
        .set({
          status: eventName === "participant_connection_aborted" ? "aborted" : "left",
          leftAt: new Date(),
        })
        .where(
          and(
            eq(meetingParticipants.sessionId, meetingId),
            eq(meetingParticipants.livekitIdentity, identity),
            inArray(meetingParticipants.status, CURRENT_MEETING_PARTICIPANT_STATUSES),
          ),
        )
    )
      .catch((err) => {
        logError(`[webhook] Failed to mark participant as left for ${eventName}:`, err);
      });

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
      const db = createDb(env.DB);
      const meeting = await db.query.meetingSessions.findFirst({
        where: eq(meetingSessions.id, meetingId),
        columns: { id: true, activeEgressId: true },
      });
      const egressId = meeting?.activeEgressId;
      if (egressId) {
        if (egressId.startsWith("__starting__:")) {
          // Room closed while recording was still in the "starting" window.
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
        await finalizeSessionByMeetingId(db, {
          meetingId,
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
  const db = createDb(env.DB);
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

  if (egress.status !== EgressStatus.EGRESS_COMPLETE) {
    logWarn(
      `[webhook] Egress ended without a completed recording ` +
        `(meeting: ${meetingId}, egress: ${egress.egressId}, status: ${egress.status})`,
    );
    await clearActiveEgress();
    return;
  }

  const fileResult = egress.fileResults[0];
  if (!fileResult?.filename) {
    logWarn(
      `[webhook] Completed egress did not include a file result ` +
        `(meeting: ${meetingId}, egress: ${egress.egressId})`,
    );
    await clearActiveEgress();
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
  if (alreadyRegistered) return;

  const rawSize = fileResult.size;
  if (typeof rawSize !== "bigint" || rawSize <= 0n) {
    logWarn(`[webhook] Recording has invalid size (${rawSize}), skipping registration`);
    return;
  }
  if (rawSize > BigInt(Number.MAX_SAFE_INTEGER)) {
    logWarn(`[webhook] Recording size ${rawSize} exceeds safe integer range, skipping`);
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
}
