const WHITEBOARD_PREFIX = "wb";

export function whiteboardAssetPrefix(meetingId: string): string {
  return `${WHITEBOARD_PREFIX}/${meetingId}/`;
}

export function buildWhiteboardAssetKey(meetingId: string, filename: string): string {
  return `${whiteboardAssetPrefix(meetingId)}${filename}`;
}

export function isValidWhiteboardAssetKeyForMeeting(r2Key: string, meetingId: string): boolean {
  return r2Key.startsWith(whiteboardAssetPrefix(meetingId));
}

export function extractMeetingIdFromWhiteboardUploadKey(key: string): string | null {
  const match = key.match(/^uploads\/[^/]+\/wb\/([^/]+)\//);
  return match?.[1] ?? null;
}
