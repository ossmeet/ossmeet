export interface MeetingWhiteboardHandle {
  importExternalImage: (url: string) => Promise<void>;
  clearPendingRequest: (userId: string) => void;
  syncCurrentPage: () => Promise<boolean>;
}

export type PendingWriteRequest = {
  userId: string;
  userName: string;
};

export interface JoinResult {
  token: string;
  serverUrl: string;
  roomName: string;
  sessionId: string;
  meetingId: string;
  participantId: string;
  isHost: boolean;
  participantName: string;
  participantIdentity: string;
  meetingTitle: string | null;
  turnServers: Array<{ urls: string[]; username: string; credential: string }>;
  expiresIn: number;
  whiteboardEnabled?: boolean;
  whiteboardDisabledReason?: string | null;
  whiteboardToken?: string | null;
  whiteboardUrl?: string | null;
  recordingEnabled?: boolean;
  recordingActive?: boolean;
  activeEgressId?: string | null;
}
