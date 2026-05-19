import * as React from "react";
import { ConnectionState, RoomEvent, type Room } from "livekit-client";
import {
  getWhiteboardToken,
  getWhiteboardSnapshotUploadUrl,
  saveWhiteboardSnapshot,
} from "./server/meetings/whiteboard";
import type { ExportSnapshotFn } from "../react";
import { logError } from "@/lib/logger-client";
import type { JoinResult } from "@/lib/meeting/types";
import { preloadMeetingWhiteboardModule } from "./preload-whiteboard";

const WHITEBOARD_TOKEN_REFRESH_BUFFER_MS = 60 * 1000;
const WHITEBOARD_TOKEN_MIN_REFRESH_DELAY_MS = 30 * 1000;
const WHITEBOARD_LOAD_TIMEOUT_MS = 15_000;

function getWhiteboardTokenMetadata(token: string): {
  expiresAt: number | null;
  connectionId: string | null;
  service: string | null;
} {
  try {
    const payload = token.split(".")[1];
    if (!payload) {
      return { expiresAt: null, connectionId: null, service: null };
    }
    const decoded = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/"))) as {
      exp?: number;
      connectionId?: string;
      service?: string;
    };
    return {
      expiresAt: typeof decoded.exp === "number" ? decoded.exp * 1000 : null,
      connectionId: typeof decoded.connectionId === "string" ? decoded.connectionId : null,
      service: typeof decoded.service === "string" ? decoded.service : null,
    };
  } catch {
    return { expiresAt: null, connectionId: null, service: null };
  }
}

interface WhiteboardSessionReturn {
  whiteboardToken: string | null;
  whiteboardWsUrl: string | null;
  getWhiteboardWebSocketUri: () => Promise<string>;
  whiteboardViewState: "idle" | "loading" | "ready" | "error";
  showWhiteboard: boolean;
  setShowWhiteboard: React.Dispatch<React.SetStateAction<boolean>>;
  openWhiteboard: () => Promise<void>;
  closeWhiteboard: (opts?: { saveSnapshot?: boolean }) => Promise<void>;
  handleWhiteboardStatusChange: (status: "loading" | "ready" | "error") => void;
  handleWhiteboardConnectionStatusChange: (status: "online" | "offline") => void;
  exportSnapshotRef: React.RefObject<ExportSnapshotFn | null>;
}

export function useWhiteboardSession(
  joinResult: JoinResult,
  roomInstance: Room | undefined
): WhiteboardSessionReturn {
  const mountedRef = React.useRef(true);
  React.useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const [whiteboardToken, setWhiteboardToken] = React.useState<string | null>(
    joinResult.whiteboardToken ?? null
  );
  const [whiteboardWsUrl, setWhiteboardWsUrl] = React.useState<string | null>(
    joinResult.whiteboardUrl ?? null
  );
  const initialTokenMetadata = React.useMemo(
    () =>
      joinResult.whiteboardToken
        ? getWhiteboardTokenMetadata(joinResult.whiteboardToken)
        : { expiresAt: null, connectionId: null, service: null },
    [joinResult.whiteboardToken]
  );
  const [whiteboardTokenExpiresAt, setWhiteboardTokenExpiresAt] = React.useState<number | null>(
    initialTokenMetadata.expiresAt
  );
  const [whiteboardTokenConnectionId, setWhiteboardTokenConnectionId] = React.useState<string | null>(
    initialTokenMetadata.connectionId
  );
  const [whiteboardTokenParticipantBound, setWhiteboardTokenParticipantBound] = React.useState(
    !!initialTokenMetadata.connectionId || initialTokenMetadata.service === "recorder"
  );
  const [whiteboardViewState, setWhiteboardViewState] = React.useState<
    "idle" | "loading" | "ready" | "error"
  >("idle");
  const [whiteboardConnectionStatus, setWhiteboardConnectionStatus] = React.useState<
    "online" | "offline"
  >("online");
  const [showWhiteboard, setShowWhiteboard] = React.useState(false);
  const whiteboardAutoOpenedRef = React.useRef(false);
  const whiteboardOpenAttemptRef = React.useRef(0);
  const whiteboardTokenRefreshInFlightRef = React.useRef<Promise<{
    token: string;
    whiteboardUrl: string;
  }> | null>(null);
  const latestWhiteboardAccessRef = React.useRef({
    token: joinResult.whiteboardToken ?? null,
    whiteboardUrl: joinResult.whiteboardUrl ?? null,
    expiresAt: initialTokenMetadata.expiresAt,
    connectionId: initialTokenMetadata.connectionId,
    participantBound: !!initialTokenMetadata.connectionId || initialTokenMetadata.service === "recorder",
  });

  const exportSnapshotRef = React.useRef<ExportSnapshotFn | null>(null);
  const [livekitConnected, setLivekitConnected] = React.useState(
    roomInstance?.state === ConnectionState.Connected
  );

  React.useEffect(() => {
    if (!roomInstance) {
      setLivekitConnected(false);
      return;
    }

    const syncConnected = () => {
      setLivekitConnected(roomInstance.state === ConnectionState.Connected);
    };

    syncConnected();
    roomInstance.on(RoomEvent.Connected, syncConnected);
    roomInstance.on(RoomEvent.Disconnected, syncConnected);
    roomInstance.on(RoomEvent.Reconnecting, syncConnected);
    roomInstance.on(RoomEvent.Reconnected, syncConnected);
    return () => {
      roomInstance.off(RoomEvent.Connected, syncConnected);
      roomInstance.off(RoomEvent.Disconnected, syncConnected);
      roomInstance.off(RoomEvent.Reconnecting, syncConnected);
      roomInstance.off(RoomEvent.Reconnected, syncConnected);
    };
  }, [roomInstance]);

  const handleWhiteboardStatusChange = React.useCallback(
    (status: "loading" | "ready" | "error") => {
      setWhiteboardViewState(status);
    },
    []
  );

  const handleWhiteboardConnectionStatusChange = React.useCallback(
    (status: "online" | "offline") => {
      setWhiteboardConnectionStatus(status);
    },
    []
  );

  const refreshWhiteboardAccess = React.useCallback(async () => {
    if (whiteboardTokenRefreshInFlightRef.current) {
      return whiteboardTokenRefreshInFlightRef.current;
    }

    const refreshPromise = getWhiteboardToken({
      data: {
        meetingId: joinResult.meetingId,
        connectionId: joinResult.connectionId,
      },
    })
      .then((result) => {
        const metadata = getWhiteboardTokenMetadata(result.token);
        if (mountedRef.current) {
          setWhiteboardToken(result.token);
          setWhiteboardWsUrl(result.whiteboardUrl);
          setWhiteboardTokenExpiresAt(metadata.expiresAt);
          setWhiteboardTokenConnectionId(metadata.connectionId);
          setWhiteboardTokenParticipantBound(
            !!metadata.connectionId || metadata.service === "recorder"
          );
        }
        return result;
      })
      .finally(() => {
        if (whiteboardTokenRefreshInFlightRef.current === refreshPromise) {
          whiteboardTokenRefreshInFlightRef.current = null;
        }
      });

    whiteboardTokenRefreshInFlightRef.current = refreshPromise;
    return refreshPromise;
  }, [
    joinResult.meetingId,
    joinResult.connectionId,
  ]);

  React.useEffect(() => {
    latestWhiteboardAccessRef.current = {
      token: whiteboardToken,
      whiteboardUrl: whiteboardWsUrl,
      expiresAt: whiteboardTokenExpiresAt,
      connectionId: whiteboardTokenConnectionId,
      participantBound: whiteboardTokenParticipantBound,
    };
  }, [
    whiteboardToken,
    whiteboardWsUrl,
    whiteboardTokenExpiresAt,
    whiteboardTokenConnectionId,
    whiteboardTokenParticipantBound,
  ]);

  React.useEffect(() => {
    if (joinResult.whiteboardToken) {
      const metadata = getWhiteboardTokenMetadata(joinResult.whiteboardToken);
      setWhiteboardToken(joinResult.whiteboardToken);
      setWhiteboardTokenExpiresAt(metadata.expiresAt);
      setWhiteboardTokenConnectionId(metadata.connectionId);
      setWhiteboardTokenParticipantBound(
        !!metadata.connectionId || metadata.service === "recorder"
      );
    }
    if (joinResult.whiteboardUrl) {
      setWhiteboardWsUrl(joinResult.whiteboardUrl);
    }
  }, [joinResult.whiteboardToken, joinResult.whiteboardUrl]);

  const shouldRefreshWhiteboardToken = React.useCallback(() => {
    if (!whiteboardToken || !whiteboardWsUrl) return true;
    if (!whiteboardTokenExpiresAt) return true;
    if (!whiteboardTokenParticipantBound) return true;
    if (!whiteboardTokenConnectionId) return true;
    if (joinResult.connectionId && whiteboardTokenConnectionId !== joinResult.connectionId) {
      return true;
    }
    return Date.now() >= whiteboardTokenExpiresAt - WHITEBOARD_TOKEN_REFRESH_BUFFER_MS;
  }, [
    joinResult.connectionId,
    whiteboardToken,
    whiteboardWsUrl,
    whiteboardTokenExpiresAt,
    whiteboardTokenConnectionId,
    whiteboardTokenParticipantBound,
  ]);

  const getWhiteboardWebSocketUri = React.useCallback(async () => {
    let {
      token,
      whiteboardUrl: wsBaseUrl,
      expiresAt,
      connectionId: tokenConnectionId,
      participantBound,
    } = latestWhiteboardAccessRef.current;
    const shouldRefresh =
      !token ||
      !wsBaseUrl ||
      !expiresAt ||
      !participantBound ||
      !tokenConnectionId ||
      (joinResult.connectionId != null && tokenConnectionId !== joinResult.connectionId) ||
      Date.now() >= expiresAt - WHITEBOARD_TOKEN_REFRESH_BUFFER_MS;

    if (shouldRefresh) {
      const refreshed = await refreshWhiteboardAccess();
      token = refreshed.token;
      wsBaseUrl = refreshed.whiteboardUrl;
    }

    if (!token || !wsBaseUrl) {
      throw new Error("Whiteboard connection is unavailable");
    }

    const url = new URL("/connect", wsBaseUrl);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.hash = new URLSearchParams({ token }).toString();
    return url.toString();
  }, [joinResult.connectionId, refreshWhiteboardAccess]);

  const openWhiteboardInternal = React.useCallback(async (source: "manual" | "auto") => {
    if (!joinResult.whiteboardEnabled) return;
    if (!livekitConnected) {
      if (source === "manual") {
        setShowWhiteboard(true);
        setWhiteboardViewState("loading");
      }
      return;
    }

    const attemptId = ++whiteboardOpenAttemptRef.current;
    setShowWhiteboard(true);
    setWhiteboardViewState("loading");
    preloadMeetingWhiteboardModule().catch(() => {});

    try {
      if (shouldRefreshWhiteboardToken()) {
        await refreshWhiteboardAccess();
      }
    } catch (err) {
      if (!mountedRef.current || whiteboardOpenAttemptRef.current !== attemptId) return;
      setWhiteboardViewState("error");
      logError(`[whiteboard] ${source} open failed`, err);
      return;
    }

    if (!mountedRef.current || whiteboardOpenAttemptRef.current !== attemptId) return;
  }, [
    joinResult.whiteboardEnabled,
    livekitConnected,
    refreshWhiteboardAccess,
    shouldRefreshWhiteboardToken,
  ]);

  const openWhiteboard = React.useCallback(async () => {
    await openWhiteboardInternal("manual");
  }, [openWhiteboardInternal]);

  const closeWhiteboard = React.useCallback(
    async (opts?: { saveSnapshot?: boolean }) => {
      let snapshotBlob: Blob | null = null;

      if (opts?.saveSnapshot && joinResult.isHost && exportSnapshotRef.current) {
        try {
          snapshotBlob = await exportSnapshotRef.current();
        } catch (err) {
          logError("[whiteboard] Failed to generate snapshot", err);
        }
      }

      setShowWhiteboard(false);
      setWhiteboardViewState("idle");
      whiteboardOpenAttemptRef.current += 1;

      if (!snapshotBlob) return;

      const snapshotPromise = (async () => {
        try {
          const { uploadUrl, r2Key } = await getWhiteboardSnapshotUploadUrl({
            data: {
              meetingId: joinResult.meetingId,
              fileSize: snapshotBlob.size,
              mimeType: "image/png",
            },
          });

          const uploadResponse = await fetch(uploadUrl, {
            method: "PUT",
            headers: {
              "Content-Type": "image/png",
              "Content-Length": String(snapshotBlob.size),
            },
            body: snapshotBlob,
          });

          if (!uploadResponse.ok) {
            throw new Error(`Snapshot upload failed: ${uploadResponse.status}`);
          }

          await saveWhiteboardSnapshot({
            data: {
              sessionId: joinResult.meetingId,
              r2Key,
            },
          });
        } catch (err) {
          logError("[whiteboard] Failed to save snapshot", err);
        }
      })();

      void snapshotPromise;
    },
    [joinResult.meetingId, joinResult.isHost]
  );

  React.useEffect(() => {
    if (!showWhiteboard || !joinResult.whiteboardEnabled || !whiteboardToken || !whiteboardTokenExpiresAt) return;

    const refreshInMs = Math.max(
      whiteboardTokenExpiresAt - Date.now() - WHITEBOARD_TOKEN_REFRESH_BUFFER_MS,
      WHITEBOARD_TOKEN_MIN_REFRESH_DELAY_MS
    );

    const timer = setTimeout(() => {
      refreshWhiteboardAccess().catch((err) => {
        logError("[whiteboard] Token refresh failed", err);
      });
    }, refreshInMs);

    const handleVisibilityChange = () => {
      if (document.visibilityState !== "visible") return;
      if (Date.now() < whiteboardTokenExpiresAt - WHITEBOARD_TOKEN_REFRESH_BUFFER_MS) return;
      refreshWhiteboardAccess().catch((err) => {
        logError("[whiteboard] Token refresh on resume failed", err);
      });
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [
    showWhiteboard,
    joinResult.whiteboardEnabled,
    refreshWhiteboardAccess,
    whiteboardToken,
    whiteboardTokenExpiresAt,
  ]);

  React.useEffect(() => {
    if (!showWhiteboard || whiteboardConnectionStatus !== "offline") return;
    if (!shouldRefreshWhiteboardToken()) return;

    refreshWhiteboardAccess().catch((err) => {
      logError("[whiteboard] Token refresh during reconnect failed", err);
    });
  }, [
    showWhiteboard,
    whiteboardConnectionStatus,
    shouldRefreshWhiteboardToken,
    refreshWhiteboardAccess,
  ]);

  React.useEffect(() => {
    if (!showWhiteboard || whiteboardViewState !== "loading") return;

    const timer = setTimeout(() => {
      setWhiteboardViewState("error");
      logError("[whiteboard] Timed out waiting for canvas to become ready");
    }, WHITEBOARD_LOAD_TIMEOUT_MS);

    return () => clearTimeout(timer);
  }, [showWhiteboard, whiteboardViewState]);

  // Product requirement: meetingSessions are whiteboard-first by default.
  // Keep the automatic open behavior, but retain the chunk-splitting work so
  // heavyweight whiteboard sub-features are fetched more selectively.
  React.useEffect(() => {
    if (!joinResult.whiteboardEnabled || !livekitConnected || whiteboardAutoOpenedRef.current) {
      return;
    }

    const autoOpen = async () => {
      whiteboardAutoOpenedRef.current = true;
      await openWhiteboardInternal("auto");
    };

    void autoOpen();
  }, [
    joinResult.whiteboardEnabled,
    livekitConnected,
    openWhiteboardInternal,
  ]);

  return {
    whiteboardToken,
    whiteboardWsUrl,
    getWhiteboardWebSocketUri,
    whiteboardViewState,
    showWhiteboard,
    setShowWhiteboard,
    openWhiteboard,
    closeWhiteboard,
    handleWhiteboardStatusChange,
    handleWhiteboardConnectionStatusChange,
    exportSnapshotRef,
  };
}
