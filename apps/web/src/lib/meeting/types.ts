export interface MeetingWhiteboardHandle {
  importExternalImage: (url: string) => Promise<void>;
  clearPendingRequest: (userId: string) => void;
  syncCurrentPage: () => Promise<boolean>;
}

export type PendingEditorAccessRequest = {
  userId: string;
  userName: string;
};

export interface MeetingLifecycleHooks {
  onBeforeLeave?: () => Promise<void>;
  onBeforeEnd?: () => Promise<void>;
}

export type HostPermissionRequest =
  | { kind: "screen-share"; id: string; userId: string; userName: string }
  | { kind: "whiteboard-edit"; id: string; userId: string; userName: string };

export interface JoinResult {
  token: string;
  serverUrl: string;
  roomName: string;
  sessionId: string;
  meetingId: string;
  connectionId: string;
  admissionId: string;
  isHost: boolean;
  isActingModerator?: boolean;
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
  streamingActive?: boolean;
  activeStreamEgressId?: string | null;
}
