import * as React from "react";
import { logError } from "@/lib/logger-client";
import { refreshMeetingToken } from "@/server/meetings/tokens";
import {
  TOKEN_REFRESH_BUFFER_MS,
  getMeetingTokenRefreshDelayMs,
  getMeetingTokenRefreshFailureMessage,
  getMeetingTokenRetryDelayMs,
} from "./token-refresh";
import type { JoinResult } from "./types";

export type TokenRefreshUpdate = {
  token: string;
  expiresIn: number;
  turnServers: JoinResult["turnServers"];
  connectionId?: string;
  admissionId?: string;
  participantIdentity?: string;
  isHost?: boolean;
  isActingModerator?: boolean;
  whiteboardToken?: string | null;
  whiteboardUrl?: string | null;
  recordingActive?: boolean;
  activeEgressId?: string | null;
  streamingActive?: boolean;
  activeStreamEgressId?: string | null;
};

export function useMeetingTokenRefresh({
  showConnectingOverlay,
  meetingId,
  connectionId,
  expiresIn,
  onJoinResultUpdate,
  onSessionRefreshFailure,
  disconnectRoomNow,
}: {
  showConnectingOverlay: boolean;
  meetingId: string;
  connectionId: string;
  expiresIn: number;
  onJoinResultUpdate: (updates: TokenRefreshUpdate) => void;
  onSessionRefreshFailure: (message: string) => void;
  disconnectRoomNow: () => Promise<void>;
}): void {
  React.useEffect(() => {
    if (showConnectingOverlay || !expiresIn || !meetingId || !connectionId) return;

    let cancelled = false;
    let timer: number | null = null;
    let transientRetryAttempt = 0;
    let tokenExpiresAt = Date.now() + expiresIn * 1000;
    let refreshInFlight: Promise<void> | null = null;

    const runRefresh = async () => {
      if (refreshInFlight) return refreshInFlight;

      refreshInFlight = (async () => {
        try {
          const result = await refreshMeetingToken({
            data: { sessionId: meetingId, connectionId },
          });

          if (cancelled) return;

          onJoinResultUpdate({
            token: result.token,
            expiresIn: result.expiresIn,
            turnServers: result.turnServers,
            connectionId: result.connectionId,
            admissionId: result.admissionId,
            participantIdentity: result.participantIdentity,
            isHost: result.isHost,
            isActingModerator: result.isActingModerator,
            whiteboardToken: result.whiteboardToken,
            whiteboardUrl: result.whiteboardUrl,
            recordingActive: result.recordingActive,
            activeEgressId: result.activeEgressId,
            streamingActive: result.streamingActive,
            activeStreamEgressId: result.activeStreamEgressId,
          });

          tokenExpiresAt = Date.now() + result.expiresIn * 1000;
          transientRetryAttempt = 0;
          scheduleRefresh(getMeetingTokenRefreshDelayMs(result.expiresIn));
        } catch (err) {
          if (cancelled) return;

          logError("[Meeting] Token refresh failed:", err);
          const terminalMessage = getMeetingTokenRefreshFailureMessage(err);
          if (terminalMessage) {
            await disconnectRoomNow();
            if (!cancelled) {
              onSessionRefreshFailure(terminalMessage);
            }
            return;
          }

          const retryDelayMs = getMeetingTokenRetryDelayMs(transientRetryAttempt);
          transientRetryAttempt += 1;
          scheduleRefresh(retryDelayMs);
        } finally {
          refreshInFlight = null;
        }
      })();

      return refreshInFlight;
    };

    const scheduleRefresh = (delayMs: number) => {
      timer = window.setTimeout(async () => {
        await runRefresh();
      }, delayMs);
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState !== "visible") return;
      if (Date.now() < tokenExpiresAt - TOKEN_REFRESH_BUFFER_MS) return;
      if (timer !== null) {
        window.clearTimeout(timer);
        timer = null;
      }
      void runRefresh();
    };

    scheduleRefresh(getMeetingTokenRefreshDelayMs(expiresIn));
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      cancelled = true;
      if (timer !== null) {
        window.clearTimeout(timer);
      }
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [
    showConnectingOverlay,
    expiresIn,
    meetingId,
    connectionId,
    onJoinResultUpdate,
    onSessionRefreshFailure,
    disconnectRoomNow,
  ]);
}
