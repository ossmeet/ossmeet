import { rooms, meetingSessions } from "@ossmeet/db/schema";
import { eq } from "drizzle-orm";
import { getPlanLimits } from "@ossmeet/shared";
import type { PlanType } from "@ossmeet/shared";

type RecordingRepairDb = {
  update: (...args: any[]) => any;
  batch: (...args: any[]) => Promise<unknown>;
};

type ReusableRoomLink = {
  id: string;
  hostId: string;
  recordingEnabled: boolean;
};

type ReusableRoomMeeting = {
  id: string;
  recordingEnabled: boolean;
};

type SyncReusableRoomRecordingInput = {
  db: RecordingRepairDb;
  link: ReusableRoomLink;
  meeting: ReusableRoomMeeting;
  userId: string | null;
  hostPlan: PlanType;
};

export async function syncReusableRoomRecordingEnabled({
  db,
  link,
  meeting,
  userId,
  hostPlan,
}: SyncReusableRoomRecordingInput) {
  const limits = getPlanLimits(hostPlan);
  const isEligibleHost = userId === link.hostId;

  if (!isEligibleHost || !limits.recordingEnabled) {
    return {
      changed: false,
      recordingEnabled: meeting.recordingEnabled,
    };
  }

  const statements = [];
  const now = new Date();

  if (!link.recordingEnabled) {
    statements.push(
      db
        .update(rooms)
        .set({ recordingEnabled: true, updatedAt: now })
        .where(eq(rooms.id, link.id))
    );
  }

  if (!meeting.recordingEnabled) {
    statements.push(
      db
        .update(meetingSessions)
        .set({ recordingEnabled: true, updatedAt: now })
        .where(eq(meetingSessions.id, meeting.id))
    );
  }

  if (statements.length === 0) {
    return {
      changed: false,
      recordingEnabled: true,
    };
  }

  await db.batch(statements);

  return {
    changed: true,
    recordingEnabled: true,
  };
}
