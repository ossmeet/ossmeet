import type {
  MEETING_ADMISSION_STATUSES,
  MEETING_ADMISSION_SUBJECT_TYPES,
  MEETING_LIVEKIT_PRESENCE_STATUSES,
  PlanType,
  MEETING_ROLES,
} from "./constants";

export type MeetingRole = (typeof MEETING_ROLES)[number];
export type MeetingAdmissionSubjectType = (typeof MEETING_ADMISSION_SUBJECT_TYPES)[number];
export type MeetingAdmissionStatus = (typeof MEETING_ADMISSION_STATUSES)[number];
export type MeetingLivekitPresenceStatus = (typeof MEETING_LIVEKIT_PRESENCE_STATUSES)[number];

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  image: string | null;
  plan: PlanType;
  role: "admin" | "user";
  subscriptionStatus: "active" | "canceled" | "past_due" | "trialing" | "paused" | null;
}

// PublicUser is the canonical type — same as SessionUser
// (the previous Omit<SessionUser, "email"> & { email: string } was a no-op)
export type PublicUser = SessionUser;
