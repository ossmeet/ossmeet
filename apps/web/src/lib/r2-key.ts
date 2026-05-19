/**
 * Generate R2 object keys for different asset types
 */
export function meetingAssetKey(meetingId: string, filename: string): string {
  return `sessions/${meetingId}/${filename}`;
}

export function spaceAssetKey(spaceId: string, filename: string): string {
  return `spaces/${spaceId}/${filename}`;
}

export function whiteboardSnapshotKey(meetingId: string): string {
  return `whiteboards/${meetingId}/whiteboard-snapshot.png`;
}

export function whiteboardStateKey(meetingId: string): string {
  return `whiteboard/${meetingId}/snapshot.json`;
}

export function whiteboardExportPdfKey(meetingId: string): string {
  return `whiteboard/${meetingId}/export.pdf`;
}
