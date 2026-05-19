import type { Database } from "@ossmeet/db";
import { meetingAdmissions, meetingLivekitPresences, meetingEvents } from "@ossmeet/db/schema";
import { generateId } from "@ossmeet/shared";
import type {
  MeetingAdmissionStatus,
  MeetingAdmissionSubjectType,
  MeetingLivekitPresenceStatus,
  MeetingRole,
} from "@ossmeet/shared";
import { sql } from "drizzle-orm";
import { withD1Retry } from "@/lib/db-utils";

interface EnsureMeetingAdmissionInput {
  id?: string;
  sessionId: string;
  subjectType: MeetingAdmissionSubjectType;
  subjectUserId?: string | null;
  guestSecretHash?: string | null;
  displayName: string;
  requestedRole: MeetingRole;
  admissionStatus: MeetingAdmissionStatus;
  decisionReason?: string | null;
  decidedByUserId?: string | null;
  decidedAt?: Date | null;
}

export async function ensureMeetingAdmission(
  db: Database,
  input: EnsureMeetingAdmissionInput,
): Promise<string> {
  const admissionId = input.id ?? generateId("MEETING_ADMISSION");
  const now = input.decidedAt ?? new Date();
  const grantedRole = input.admissionStatus === "approved" ? input.requestedRole : null;

  await withD1Retry(() =>
    db
      .insert(meetingAdmissions)
      .values({
        id: admissionId,
        sessionId: input.sessionId,
        subjectType: input.subjectType,
        subjectUserId: input.subjectUserId ?? null,
        guestSecretHash: input.guestSecretHash ?? null,
        displayName: input.displayName,
        requestedRole: input.requestedRole,
        grantedRole,
        admissionStatus: input.admissionStatus,
        decisionReason: input.decisionReason ?? null,
        decidedByUserId: input.decidedByUserId ?? null,
        decidedAt: input.admissionStatus === "awaiting_approval" ? null : now,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: meetingAdmissions.id,
        set: {
          subjectType: input.subjectType,
          subjectUserId: input.subjectUserId ?? null,
          guestSecretHash: input.guestSecretHash ?? null,
          displayName: input.displayName,
          requestedRole: input.requestedRole,
          grantedRole,
          admissionStatus: input.admissionStatus,
          decisionReason: input.decisionReason ?? null,
          decidedByUserId: input.decidedByUserId ?? null,
          decidedAt: input.admissionStatus === "awaiting_approval" ? null : now,
          updatedAt: now,
        },
      }),
  );

  return admissionId;
}

interface UpsertMeetingLivekitPresenceInput {
  sessionId: string;
  admissionId: string;
  livekitIdentity: string;
  livekitParticipantSid?: string | null;
  userId?: string | null;
  role: MeetingRole;
  presenceStatus: MeetingLivekitPresenceStatus;
  disconnectReason?: string | null;
  now?: Date;
}

export async function upsertMeetingLivekitPresence(
  db: Database,
  input: UpsertMeetingLivekitPresenceInput,
): Promise<string> {
  const connectionId = generateId("MEETING_LIVEKIT_PRESENCE");
  const now = input.now ?? new Date();
  // `token_issued` is the pre-LiveKit-join state. Refreshing credentials for a
  // participant who is already connected must not demote their realtime
  // presence; LiveKit webhooks remain the source of connected/disconnected
  // transitions after the first join.
  const presenceStatus = input.presenceStatus;
  const tokenIssuedAt = now;
  const connectedAt =
    presenceStatus === "connected"
      ? now
      : presenceStatus === "disconnected" || presenceStatus === "aborted"
        ? null
        : null;
  const disconnectedAt = presenceStatus === "disconnected" || presenceStatus === "aborted" ? now : null;
  const lastWebhookAt = input.presenceStatus === "token_issued" ? null : now;

  // Use RETURNING so concurrent callers see the canonical row id rather than
  // the candidate `connectionId` they generated locally — otherwise the loser
  // of an insert race would return an id that does not exist in the row.
  const upserted = await withD1Retry(() =>
    db
      .insert(meetingLivekitPresences)
      .values({
        id: connectionId,
        sessionId: input.sessionId,
        admissionId: input.admissionId,
        livekitIdentity: input.livekitIdentity,
        livekitParticipantSid: input.livekitParticipantSid ?? null,
        userId: input.userId ?? null,
        role: input.role,
        presenceStatus,
        disconnectReason: input.disconnectReason ?? null,
        tokenIssuedAt,
        connectedAt,
        disconnectedAt,
        lastWebhookAt,
      })
      .onConflictDoUpdate({
        target: [meetingLivekitPresences.sessionId, meetingLivekitPresences.livekitIdentity],
        set: {
          admissionId: input.admissionId,
          livekitParticipantSid: sql`coalesce(excluded.livekit_participant_sid, ${meetingLivekitPresences.livekitParticipantSid})`,
          userId: sql`coalesce(excluded.user_id, ${meetingLivekitPresences.userId})`,
          role: input.role,
          presenceStatus: sql`
            case
              when excluded.presence_status = 'token_issued'
                and ${meetingLivekitPresences.presenceStatus} = 'connected'
              then ${meetingLivekitPresences.presenceStatus}
              else excluded.presence_status
            end
          `,
          disconnectReason: input.disconnectReason ?? null,
          tokenIssuedAt: sql`
            case
              when excluded.presence_status = 'token_issued'
                and ${meetingLivekitPresences.presenceStatus} = 'connected'
              then ${meetingLivekitPresences.tokenIssuedAt}
              else excluded.token_issued_at
            end
          `,
          connectedAt: sql`
            case
              when excluded.presence_status = 'token_issued'
                and ${meetingLivekitPresences.presenceStatus} = 'connected'
              then ${meetingLivekitPresences.connectedAt}
              when excluded.presence_status = 'connected'
              then coalesce(${meetingLivekitPresences.connectedAt}, excluded.connected_at)
              when excluded.presence_status in ('disconnected', 'aborted')
              then ${meetingLivekitPresences.connectedAt}
              else excluded.connected_at
            end
          `,
          disconnectedAt: sql`
            case
              when excluded.presence_status = 'token_issued'
                and ${meetingLivekitPresences.presenceStatus} = 'connected'
              then ${meetingLivekitPresences.disconnectedAt}
              else excluded.disconnected_at
            end
          `,
          lastWebhookAt: sql`
            case
              when excluded.presence_status = 'token_issued'
                and ${meetingLivekitPresences.presenceStatus} = 'connected'
              then ${meetingLivekitPresences.lastWebhookAt}
              else excluded.last_webhook_at
            end
          `,
          updatedAt: now,
        },
      })
      .returning({ id: meetingLivekitPresences.id }),
  );

  return upserted[0]?.id ?? connectionId;
}

export async function appendMeetingEvent(
  db: Database,
  input: {
    sessionId: string;
    kind: string;
    subjectId?: string | null;
    payload?: Record<string, unknown> | null;
    occurredAt?: Date;
  },
): Promise<void> {
  await withD1Retry(() =>
    db.insert(meetingEvents).values({
      id: generateId("MEETING_EVENT"),
      sessionId: input.sessionId,
      kind: input.kind,
      subjectId: input.subjectId ?? null,
      payload: input.payload ? JSON.stringify(input.payload) : null,
      occurredAt: input.occurredAt ?? new Date(),
    }),
  );
}
