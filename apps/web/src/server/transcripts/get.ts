import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { Errors } from "@ossmeet/shared";
import { authMiddleware } from "../middleware";
import { canAccessMeetingTranscriptData } from "./access";
import { listTranscriptRows } from "./query";

const getTranscriptsSchema = z.object({
  meetingId: z.string().min(1),
});

/**
 * Fetch all transcripts for a meeting, ordered chronologically.
 * Auth-guarded: caller must be a host, an approved attendee, or — for
 * space meetings — a current member of the space.
 */
export const getMeetingTranscripts = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .inputValidator(getTranscriptsSchema)
  .handler(async ({ data, context: { user, db } }) => {
    const allowed = await canAccessMeetingTranscriptData(db, data.meetingId, user.id);
    if (!allowed) throw Errors.FORBIDDEN();
    const transcripts = await listTranscriptRows(db, data.meetingId);
    return { transcripts };
  });
