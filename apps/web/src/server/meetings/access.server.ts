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
import { buildWhiteboardJoinAccessExtras } from "@whiteboard/server";
import { endSession } from "./leave-end.server";

export function getMeetingRolePublishSources(
  role: MeetingRole | "moderator"
): TrackSource[] {
  if (role === "host" || role === "moderator") {
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
  activeStreamEgressId: string | null;
}

interface IssueMeetingAccessParams {
  env: Pick<
    Env,
    | "LIVEKIT_URL"
    | "LIVEKIT_API_KEY"
    | "LIVEKIT_API_SECRET"
    | "APP_URL"
    | "ENVIRONMENT"
  >;
  meeting: Pick<ActiveMeetingAccessRecord, "id" | "title" | "recordingEnabled" | "activeEgressId" | "activeStreamEgressId">;
  connectionId: string;
  admissionId: string;
  participantIdentity: string;
  participantName: string;
  participantRole: MeetingRole;
  isHost: boolean;
  isActingModerator?: boolean;
  recordingEnabled: boolean;
}

export async function issueMeetingAccess({
  env,
  meeting,
  connectionId,
  admissionId,
  participantIdentity,
  participantName,
  participantRole,
  isHost,
  isActingModerator = false,
  recordingEnabled,
}: IssueMeetingAccessParams): Promise<JoinResult> {
  const roomName = `meet-${meeting.id}`;
  const livekitRole = isActingModerator ? "moderator" : participantRole;
  const { token, turnServers, expiresIn } = await createLiveKitAccess({
    apiKey: env.LIVEKIT_API_KEY,
    apiSecret: env.LIVEKIT_API_SECRET,
    identity: participantIdentity,
    name: participantName,
    roomName,
    isHost,
    metadata: {
      sessionId: meeting.id,
      meetingId: meeting.id,
      role: livekitRole,
      ...(isActingModerator && { actingModerator: true }),
    },
    canPublishSources: getMeetingRolePublishSources(livekitRole),
  });

  const addonExtras = buildWhiteboardJoinAccessExtras
    ? await buildWhiteboardJoinAccessExtras(env as Env, {
        meetingId: meeting.id,
        participantIdentity,
        participantName,
        participantRole: isActingModerator ? "participant" : participantRole,
        connectionId,
      })
    : {};

  return {
    token,
    serverUrl: env.LIVEKIT_URL,
    roomName,
    sessionId: meeting.id,
    meetingId: meeting.id,
    connectionId,
    admissionId,
    isHost,
    isActingModerator,
    participantName,
    participantIdentity,
    meetingTitle: meeting.title,
    turnServers,
    expiresIn,
    recordingEnabled,
    recordingActive:
      !!meeting.activeEgressId && !meeting.activeEgressId.startsWith("__starting__:"),
    activeEgressId: isHost ? meeting.activeEgressId : null,
    streamingActive:
      !!meeting.activeStreamEgressId && !meeting.activeStreamEgressId.startsWith("__starting__:"),
    activeStreamEgressId: isHost ? meeting.activeStreamEgressId : null,
    ...addonExtras,
  };
}

export async function enforceMeetingDurationLimit(
  db: Database,
  env: Env,
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

  await endSession(db, env, meeting.id, "system");
  throw Errors.NOT_FOUND("Meeting has ended");
}
