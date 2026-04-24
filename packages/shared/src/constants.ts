// Session & auth timing
export const SESSION_EXPIRY_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
export const SESSION_EXPIRY_SECONDS = 30 * 24 * 60 * 60;
export const SESSION_REFRESH_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000; // Refresh if <7 days left
export const SESSION_ABSOLUTE_EXPIRY_MS = 90 * 24 * 60 * 60 * 1000; // Hard cap regardless of activity
export const OTP_EXPIRY_MS = 10 * 60 * 1000; // 10 minutes

// Cloudflare D1 limit. Reserve parameters for non-IN predicates before chunking.
export const D1_MAX_BOUND_PARAMETERS = 100;

// JSON text CHECK limits used by D1-backed metadata columns.
export const DB_JSON_TEXT_MAX_LENGTH = 32_768;

// AI notes output bounds. These sit comfortably below DB_JSON_TEXT_MAX_LENGTH
// after JSON serialization and keep model output predictable.
export const MEETING_NOTES_SUMMARY_MAX_LENGTH = 8_000;
export const MEETING_NOTES_TOPIC_MAX_LENGTH = 200;
export const MEETING_NOTES_TOPIC_MAX_ITEMS = 30;
export const MEETING_NOTES_DETAIL_MAX_LENGTH = 500;
export const MEETING_NOTES_DETAIL_MAX_ITEMS = 50;

// ID prefixes
export const ID_PREFIX = {
  USER: "usr_",
  SESSION: "ses_",
  DEVICE: "dev_",
  PASSKEY: "psk_",
  SPACE: "spc_",
  ROOM: "room_",
  MEETING_SESSION: "msn_",
  INVITE: "inv_",
  ASSET: "ast_",
  MEETING_ARTIFACT: "mfa_",
  MEMBER: "mbr_",
  PARTICIPANT: "ptc_",
  ACCOUNT: "acc_",
  TRANSCRIPT: "trn_",
  MEETING_SUMMARY: "sum_",
} as const;

// Meeting code format: xxx-xxxx-xxx (only format, for both random and pro-chosen codes)
export const MEETING_CODE_REGEX = /^[a-z]{3}-[a-z]{4}-[a-z]{3}$/;
export const MEETING_CODE_LENGTH = 12; // 3+4+3 letters + 2 dashes

// Permanent rooms expire 1 year after last use (or creation if never used).
export const ROOM_EXPIRY_MS = 365 * 24 * 60 * 60 * 1000; // 1 year

// Plan types
export const PLAN_TYPES = ["free", "pro", "org"] as const;
export type PlanType = (typeof PLAN_TYPES)[number];

// Roles
export const USER_ROLES = ["admin", "user"] as const;
export const SPACE_ROLES = ["owner", "admin", "member"] as const;
export const MEETING_ROLES = ["host", "participant", "guest"] as const;
export const MEETING_STATUSES = ["active", "ended"] as const;
export const MEETING_PARTICIPANT_STATUSES = [
  "awaiting_approval",
  "pending",
  "active",
  "left",
  "aborted",
  "denied",
] as const;
export const CURRENT_MEETING_PARTICIPANT_STATUSES = ["pending", "active"] as const;
// Includes awaiting_approval — used when we need to count slot usage (participant cap, finalize-empty guards).
export const OCCUPYING_MEETING_PARTICIPANT_STATUSES = [
  "awaiting_approval",
  "pending",
  "active",
] as const;
export const SPACE_ASSET_TYPES = [
  "pdf",
] as const;
export const MEETING_ARTIFACT_TYPES = [
  "recording",
  "whiteboard_snapshot",
  "whiteboard_state",
  "whiteboard_pdf",
] as const;
export const ASSET_TYPES = [...SPACE_ASSET_TYPES, ...MEETING_ARTIFACT_TYPES] as const;
export const INVITE_ROLES = ["admin", "member"] as const;
