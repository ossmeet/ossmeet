import type {
  PlanType,
  MEETING_PARTICIPANT_STATUSES,
  MEETING_ROLES,
} from "./constants";

export type MeetingRole = (typeof MEETING_ROLES)[number];
export type MeetingParticipantStatus = (typeof MEETING_PARTICIPANT_STATUSES)[number];

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
