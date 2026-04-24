import type { PlanType } from "./constants";

// Retention durations per plan (from schema comment: free→30d, pro→1y, org→null)
const MEETING_RETENTION_FREE_MS = 30 * 24 * 60 * 60 * 1000;
const MEETING_RETENTION_PRO_MS = 365 * 24 * 60 * 60 * 1000;

export function computeRetainUntil(plan: PlanType, endedAt: Date): Date | null {
  if (plan === "org") return null;
  const ms = plan === "pro" ? MEETING_RETENTION_PRO_MS : MEETING_RETENTION_FREE_MS;
  return new Date(endedAt.getTime() + ms);
}

export interface PlanLimits {
  maxParticipants: number | null; // null = unlimited
  maxConcurrentMeetings: number | null; // null = unlimited
  maxMeetingDurationMinutes: number | null; // null = unlimited
  maxSpaces: number | null; // null = unlimited
  maxStorageBytes: number | null; // null = unlimited
  recordingEnabled: boolean;
  pdfExportEnabled: boolean;
  aiAssistantEnabled: boolean;
  reusableMeetingLink: boolean; // permanent rooms that survive across sessions
  customMeetingCode: boolean;   // choose the code for a permanent room (requires reusableMeetingLink)
  customSubdomain: boolean;
  brandedExperience: boolean;
  adminDashboard: boolean;
}

export const PLAN_LIMITS: Record<PlanType, PlanLimits> = {
  free: {
    maxParticipants: 100,
    maxConcurrentMeetings: 1,
    maxMeetingDurationMinutes: 90,
    maxSpaces: 1,
    maxStorageBytes: 1 * 1024 * 1024 * 1024, // 1 GB
    recordingEnabled: false,
    pdfExportEnabled: true,
    aiAssistantEnabled: true,
    reusableMeetingLink: false,
    customMeetingCode: false,
    customSubdomain: false,
    brandedExperience: false,
    adminDashboard: false,
  },
  pro: {
    maxParticipants: 500,
    maxConcurrentMeetings: 5,
    maxMeetingDurationMinutes: null,
    maxSpaces: null,
    maxStorageBytes: 50 * 1024 * 1024 * 1024, // 50 GB
    recordingEnabled: true,
    pdfExportEnabled: true,
    aiAssistantEnabled: true,
    reusableMeetingLink: true,
    customMeetingCode: true,
    customSubdomain: false,
    brandedExperience: false,
    adminDashboard: false,
  },
  org: {
    maxParticipants: null,
    maxConcurrentMeetings: null,
    maxMeetingDurationMinutes: null,
    maxSpaces: null,
    maxStorageBytes: null, // unlimited
    recordingEnabled: true,
    pdfExportEnabled: true,
    aiAssistantEnabled: true,
    reusableMeetingLink: true,
    customMeetingCode: true,
    customSubdomain: true,
    brandedExperience: true,
    adminDashboard: true,
  },
};

export function getPlanLimits(plan: PlanType): PlanLimits {
  return PLAN_LIMITS[plan];
}
