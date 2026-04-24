import type { Database } from "@ossmeet/db";
import {
  Errors,
  getPlanLimits,
  type MeetingRole,
  type PlanType,
} from "@ossmeet/shared";
import { TrackSource } from "livekit-server-sdk";
import type { JoinResult } from "@/lib/meeting/types";
import { createLiveKitAccess } from "@/lib/meeting/livekit-token.server";
import { createWhiteboardJWT } from "@/lib/jwt-utils";
import { logError } from "@/lib/logger";
import { terminateMeetingRoom } from "./leave-end";
import { finalizeSessionByMeetingId } from "./session-finalizer";

export function getMeetingRolePublishSources(
  role: MeetingRole
): TrackSource[] {
  if (role === "host") {
    return [
      TrackSource.CAMERA,
      TrackSource.MICROPHONE,
      TrackSource.SCREEN_SHARE,
      TrackSource.SCREEN_SHARE_AUDIO,
    ];
  }
  return [TrackSource.CAMERA, TrackSource.MICROPHONE];
}

interface ActiveMeetingAccessRecord {
  id: string;
  title: string | null;
  hostId: string;
  recordingEnabled: boolean;
  startedAt: Date | null;
  activeEgressId: string | null;
}

interface IssueMeetingAccessParams {
  env: Pick<
    Env,
    | "LIVEKIT_URL"
    | "LIVEKIT_API_KEY"
    | "LIVEKIT_API_SECRET"
    | "WHITEBOARD_URL"
    | "WHITEBOARD_JWT_SECRET"
  >;
  meeting: Pick<ActiveMeetingAccessRecord, "id" | "title" | "recordingEnabled" | "activeEgressId">;
  participantId: string;
  participantIdentity: string;
  participantName: string;
  participantRole: MeetingRole;
  isHost: boolean;
  recordingEnabled: boolean;
}

export async function issueMeetingAccess({
  env,
  meeting,
  participantId,
  participantIdentity,
  participantName,
  participantRole,
  isHost,
  recordingEnabled,
}: IssueMeetingAccessParams): Promise<JoinResult> {
  const roomName = `meet-${meeting.id}`;
  const whiteboardConfigured = Boolean(env.WHITEBOARD_URL && env.WHITEBOARD_JWT_SECRET);
  const whiteboardRole =
    participantRole === "host" ? "host" : participantRole === "participant" ? "participant" : "guest";
  const [{ token, turnServers, expiresIn }, whiteboardToken] = await Promise.all([
    createLiveKitAccess({
      apiKey: env.LIVEKIT_API_KEY,
      apiSecret: env.LIVEKIT_API_SECRET,
      identity: participantIdentity,
      name: participantName,
      roomName,
      isHost,
      metadata: { sessionId: meeting.id, meetingId: meeting.id, role: participantRole },
      canPublishSources: getMeetingRolePublishSources(participantRole),
    }),
    whiteboardConfigured
      ? createWhiteboardJWT(env.WHITEBOARD_JWT_SECRET, {
          sub: participantIdentity,
          name: participantName,
          role: whiteboardRole,
          sid: `meet-${meeting.id}`,
        })
      : Promise.resolve(null),
  ]);

  return {
    token,
    serverUrl: env.LIVEKIT_URL,
    roomName,
    sessionId: meeting.id,
    meetingId: meeting.id,
    participantId,
    isHost,
    participantName,
    participantIdentity,
    meetingTitle: meeting.title,
    turnServers,
    expiresIn,
    whiteboardEnabled: whiteboardConfigured,
    whiteboardToken,
    whiteboardUrl: whiteboardConfigured ? env.WHITEBOARD_URL : null,
    recordingEnabled,
    recordingActive:
      !!meeting.activeEgressId && !meeting.activeEgressId.startsWith("__starting__:"),
    activeEgressId: isHost ? meeting.activeEgressId : null,
  };
}

export async function enforceMeetingDurationLimit(
  db: Database,
  env: Pick<
    Env,
    | "LIVEKIT_URL"
    | "LIVEKIT_API_KEY"
    | "LIVEKIT_API_SECRET"
    | "WHITEBOARD_URL"
    | "WHITEBOARD_INTERNAL_SECRET"
    | "R2_BUCKET"
  >,
  meeting: ActiveMeetingAccessRecord,
  hostPlan: PlanType
) {
  const limits = getPlanLimits(hostPlan);

  if (limits.maxMeetingDurationMinutes === null || !meeting.startedAt) {
    return limits;
  }

  const maxMs = limits.maxMeetingDurationMinutes * 60 * 1000;
  if (Date.now() - meeting.startedAt.getTime() <= maxMs) {
    return limits;
  }

  await finalizeSessionByMeetingId(db, {
    meetingId: meeting.id,
    now: new Date(),
    onlyActive: true,
    env,
  });
  await terminateMeetingRoom(env, meeting.id, meeting.activeEgressId).catch((err) => {
    logError("[meetingSessions] LiveKit cleanup failed:", err);
  });
  throw Errors.NOT_FOUND("Meeting has ended");
}
