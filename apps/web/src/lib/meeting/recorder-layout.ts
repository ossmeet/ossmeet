export type RecorderWhiteboardStatus = "loading" | "ready" | "error";
export type RecorderStage = "whiteboard" | "screen_share" | "video";
export type RecorderVideoSource = "camera" | "screen_share";

export interface RecorderTrackSummary {
  participantIdentity: string;
  source: RecorderVideoSource;
  isMuted?: boolean;
}

export interface RecorderParticipantSummary {
  identity: string;
  name?: string;
}

export function shouldMountRecorderWhiteboard({
  hasWhiteboard,
  stage,
  wbStatus,
}: {
  hasWhiteboard: boolean;
  stage: RecorderStage;
  wbStatus: RecorderWhiteboardStatus;
}): boolean {
  return hasWhiteboard && stage === "whiteboard" && wbStatus !== "error";
}

export function shouldWaitForRecorderWhiteboard({
  hasWhiteboard,
  stage,
}: {
  hasWhiteboard: boolean;
  stage: RecorderStage;
}): boolean {
  return hasWhiteboard && stage === "whiteboard";
}

export function isRecorderStartupBlockedByWhiteboard({
  hasWhiteboard,
  stage,
  wbStatus,
  wbTimedOut,
}: {
  hasWhiteboard: boolean;
  stage: RecorderStage;
  wbStatus: RecorderWhiteboardStatus;
  wbTimedOut: boolean;
}): boolean {
  return (
    shouldWaitForRecorderWhiteboard({ hasWhiteboard, stage }) &&
    wbStatus === "loading" &&
    !wbTimedOut
  );
}

export function isActiveRecorderVideoTrack(track: RecorderTrackSummary): boolean {
  return track.source === "screen_share" || track.isMuted !== true;
}

export function getRecorderAvatarParticipants({
  participants,
  activeVideoTracks,
  localParticipantIdentity,
}: {
  participants: RecorderParticipantSummary[];
  activeVideoTracks: RecorderTrackSummary[];
  localParticipantIdentity: string;
}): RecorderParticipantSummary[] {
  const activeVideoIdentities = new Set(
    activeVideoTracks
      .filter(isActiveRecorderVideoTrack)
      .map((track) => track.participantIdentity),
  );

  return participants
    .filter((participant) => participant.identity !== localParticipantIdentity)
    .filter((participant) => !activeVideoIdentities.has(participant.identity))
    .sort((a, b) => (a.name || a.identity).localeCompare(b.name || b.identity));
}

export function getRecorderGridColumnCount(totalTiles: number): number {
  if (totalTiles <= 1) return 1;
  if (totalTiles <= 4) return 2;
  return 3;
}

export function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1]?.[0] ?? "" : "";
  return `${first}${last}`.toUpperCase();
}
