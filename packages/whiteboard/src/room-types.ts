export interface SessionMeta {
  userId: string;
  userName: string;
  role: string;
  sessionId: string;
  connectionId: string;
}

export interface WsData {
  tldrawSessionId: string;
  userId: string;
  userName: string;
  role: string;
  roomId: string;
  connectionId: string;
  authCloseReason?: string;
}

export interface TldrawSocket {
  send(data: string | Uint8Array): void;
  close(code?: number, reason?: string): void;
  readyState: number;
}

export interface PendingSnapshotFile {
  sessionId: string;
  body: string;
  hash: string;
  savedAt: number;
  final: boolean;
  deleteRoomFilesOnSuccess: boolean;
}

export type StoredCanvasEditorGrant =
  | string
  | { userId: string; grantedAt?: number; approvedAt?: number };
