import { z } from "zod/v4";
import { ASSET_TYPES, MEETING_CODE_REGEX } from "../constants";

export const createMeetingSchema = z.object({
  title: z.string().max(200).optional(),
  spaceId: z.string().optional(),
  allowGuests: z.boolean().optional().default(false),
  recordingEnabled: z.boolean().optional().default(false),
  // Admission control — when true, joiners (non-host) wait for explicit approval.
  requireApproval: z.boolean().optional().default(false),
  // When true, creates a persistent meetingLink so the same URL works across sessions (pro/org only)
  permanent: z.boolean().optional().default(false),
  // Pro/org only, requires permanent: true — choose a custom code (must match xxx-xxxx-xxx format)
  customCode: z
    .string()
    .regex(MEETING_CODE_REGEX, "Code must be in abc-defg-hij format (3-4-3 lowercase letters)")
    .optional(),
});

export const lookupMeetingSchema = z.object({
  code: z.string().regex(MEETING_CODE_REGEX, "Invalid meeting code"),
});

export const admissionDecisionSchema = z.object({
  sessionId: z.string().min(1),
  participantId: z.string().min(1),
});

export const toggleMeetingLockSchema = z.object({
  sessionId: z.string().min(1),
  locked: z.boolean(),
});

export const listPendingAdmissionsSchema = z.object({
  sessionId: z.string().min(1),
});

export const joinMeetingSchema = z.object({
  code: z.string().regex(MEETING_CODE_REGEX, "Invalid meeting code"),
  displayName: z.string().min(1).max(100).optional(),
  // Allow guest reconnect via participantId — secret is read from the HttpOnly cookie
  reconnectParticipantId: z.string().min(1).optional(),
});

export const endMeetingSchema = z.object({
  sessionId: z.string().min(1),
});

export const leaveMeetingSchema = z.object({
  sessionId: z.string().min(1),
  participantId: z.string().min(1),
});

export const toggleRecordingSchema = z.object({
  sessionId: z.string().min(1),
  action: z.enum(["start", "stop"]),
  egressId: z.string().optional(),
});

export const meetingParticipantsSchema = z.object({
  sessionId: z.string().min(1),
});

export const refreshMeetingTokenSchema = z.object({
  sessionId: z.string().min(1),
  participantId: z.string().min(1),
});

export const saveWhiteboardSnapshotSchema = z.object({
  sessionId: z.string().min(1),
  r2Key: z.string().min(1).max(512)
    .regex(/^[a-zA-Z0-9][a-zA-Z0-9_\-/.]{0,510}$/, "Invalid r2Key format")
    .refine((key) => !key.includes(".."), "r2Key must not contain '..'")
    .refine(
      (key) => key.startsWith("whiteboards/"),
      "r2Key must start with 'whiteboards/'"
    ),
});

export const getMeetingSchema = z.object({
  code: z.string().regex(MEETING_CODE_REGEX, "Invalid meeting code"),
});

export const saveSessionAssetSchema = z.object({
  spaceId: z.string().min(1),
  sessionId: z.string().optional(),
  type: z.enum(ASSET_TYPES),
  r2Key: z.string().min(1).max(512)
    .regex(/^[a-zA-Z0-9][a-zA-Z0-9_\-/.]{0,510}$/, "Invalid r2Key format")
    .refine((key) => !key.includes(".."), "r2Key must not contain '..'")
    .refine(
      (key) =>
        key.startsWith("uploads/") ||
        key.startsWith("spaces/") ||
        key.startsWith("recordings/") ||
        key.startsWith("whiteboards/") ||
        key.startsWith("whiteboard/"),
      "r2Key must start with 'uploads/', 'spaces/', 'recordings/', 'whiteboards/', or 'whiteboard/'"
    ),
  filename: z.string().min(1).max(255),
  mimeType: z.string().min(1).max(100),
  size: z.number().int().nonnegative().max(100 * 1024 * 1024), // max 100 MB
}).superRefine((value, ctx) => {
  const { type, r2Key, sessionId } = value;

  if (type === "pdf" && !(r2Key.startsWith("uploads/") || r2Key.startsWith("spaces/"))) {
    ctx.addIssue({
      code: "custom",
      path: ["r2Key"],
      message: "PDF assets must use an 'uploads/' or 'spaces/' key",
    });
  }

  if (type === "recording") {
    if (!sessionId) {
      ctx.addIssue({
        code: "custom",
        path: ["sessionId"],
        message: "Recording assets require a sessionId",
      });
    }
    if (!r2Key.startsWith("recordings/")) {
      ctx.addIssue({
        code: "custom",
        path: ["r2Key"],
        message: "Recording assets must use a 'recordings/' key",
      });
    }
  }

  if (type === "whiteboard_snapshot") {
    if (!sessionId) {
      ctx.addIssue({
        code: "custom",
        path: ["sessionId"],
        message: "Whiteboard snapshot assets require a sessionId",
      });
    }
    if (!r2Key.startsWith("whiteboards/")) {
      ctx.addIssue({
        code: "custom",
        path: ["r2Key"],
        message: "Whiteboard snapshot assets must use a 'whiteboards/' key",
      });
    }
  }

  if (type === "whiteboard_state" || type === "whiteboard_pdf") {
    if (!sessionId) {
      ctx.addIssue({
        code: "custom",
        path: ["sessionId"],
        message: "Whiteboard state/pdf assets require a sessionId",
      });
    }
    if (!r2Key.startsWith("whiteboard/")) {
      ctx.addIssue({
        code: "custom",
        path: ["r2Key"],
        message: "Whiteboard state/pdf assets must use a 'whiteboard/' key",
      });
    }
  }
});
