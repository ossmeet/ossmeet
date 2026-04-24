import * as React from "react";
import type { Room } from "livekit-client";
import {
  getWhiteboardToken,
  getWhiteboardSnapshotUploadUrl,
  saveWhiteboardSnapshot,
} from "@/server/meetings/whiteboard";
import type {
  ExportPdfFn,
  ExportPdfProgressFn,
  ExportSnapshotFn,
} from "@/lib/whiteboard/client-runtime";
import { logError } from "@/lib/logger-client";
import type { JoinResult } from "./types";
import { preloadMeetingWhiteboardModule } from "./preload-whiteboard";

const WHITEBOARD_TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000;
const WHITEBOARD_TOKEN_MIN_REFRESH_DELAY_MS = 30 * 1000;
const WHITEBOARD_LOAD_TIMEOUT_MS = 15_000;

function getJwtExpiryMs(token: string): number | null {
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    const decoded = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/"))) as { exp?: number };
    return typeof decoded.exp === "number" ? decoded.exp * 1000 : null;
  } catch {
    return null;
  }
}

interface WhiteboardSessionReturn {
  whiteboardToken: string | null;
  whiteboardWsUrl: string | null;
  whiteboardViewState: "idle" | "loading" | "ready" | "error";
  showWhiteboard: boolean;
  setShowWhiteboard: React.Dispatch<React.SetStateAction<boolean>>;
  openWhiteboard: () => Promise<void>;
  closeWhiteboard: (opts?: { saveSnapshot?: boolean }) => Promise<void>;
  handleWhiteboardStatusChange: (status: "loading" | "ready" | "error") => void;
  handleWhiteboardContentStateChange: (hasContent: boolean) => void;
  exportPdfRef: React.RefObject<ExportPdfFn | null>;
  exportSnapshotRef: React.RefObject<ExportSnapshotFn | null>;
  exportChoiceRef: React.RefObject<((choice: boolean) => void) | null>;
  leavePhase: null | "prompting" | "exporting";
  setLeavePhase: React.Dispatch<React.SetStateAction<null | "prompting" | "exporting">>;
  exportProgress: string | null;
  promptAndExport: () => Promise<void>;
  saveWhiteboardPdfArtifact: () => Promise<boolean>;
}

export function useWhiteboardSession(
  joinResult: JoinResult,
  _roomInstance: Room | undefined
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
  const [whiteboardTokenExpiresAt, setWhiteboardTokenExpiresAt] = React.useState<number | null>(
    joinResult.whiteboardToken ? getJwtExpiryMs(joinResult.whiteboardToken) : null
  );
  const [whiteboardViewState, setWhiteboardViewState] = React.useState<
    "idle" | "loading" | "ready" | "error"
  >("idle");
  const [showWhiteboard, setShowWhiteboard] = React.useState(false);
  const [hasWhiteboardContent, setHasWhiteboardContent] = React.useState(false);
  const whiteboardAutoOpenedRef = React.useRef(false);
  const whiteboardOpenAttemptRef = React.useRef(0);
  const whiteboardTokenRefreshInFlightRef = React.useRef<Promise<{
    token: string;
    whiteboardUrl: string;
  }> | null>(null);

  const exportPdfRef = React.useRef<ExportPdfFn | null>(null);
  const exportSnapshotRef = React.useRef<ExportSnapshotFn | null>(null);
  const exportChoiceRef = React.useRef<((choice: boolean) => void) | null>(null);
  const [leavePhase, setLeavePhase] = React.useState<null | "prompting" | "exporting">(null);
  const [exportProgress, setExportProgress] = React.useState<string | null>(null);

  const promptAndExport = React.useCallback(async () => {
    if (!exportPdfRef.current || !hasWhiteboardContent) return;
    setLeavePhase("prompting");
    try {
      const choice = await new Promise<boolean>((resolve) => {
        exportChoiceRef.current = resolve;
      });
      exportChoiceRef.current = null;
      if (choice) {
        setLeavePhase("exporting");
        try {
          const onProgress: ExportPdfProgressFn = (current, total) => {
            setExportProgress(`Exporting page ${current} of ${total}...`);
          };
          await exportPdfRef.current({ onProgress, download: true });
        } catch {
          // No whiteboard content or other error — skip
        }
      }
    } finally {
      exportChoiceRef.current = null;
      setLeavePhase(null);
      setExportProgress(null);
    }
  }, [hasWhiteboardContent]);

  const saveWhiteboardPdfArtifact = React.useCallback(async () => {
    if (!joinResult.isHost || !exportPdfRef.current || !hasWhiteboardContent) {
      return false;
    }

    setLeavePhase("exporting");
    setExportProgress("Preparing whiteboard PDF...");

    try {
      const onProgress: ExportPdfProgressFn = (current, total) => {
        setExportProgress(`Exporting page ${current} of ${total}...`);
      };
      const pdfBlob = await exportPdfRef.current({ onProgress, download: false });
      if (!pdfBlob) return false;

      setExportProgress("Saving whiteboard PDF...");
      const response = await fetch(
        `/api/whiteboard/pdf-upload?meetingId=${encodeURIComponent(joinResult.meetingId)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/pdf" },
          body: pdfBlob,
          credentials: "same-origin",
        }
      );

      if (!response.ok) {
        throw new Error(`PDF upload failed: ${response.status}`);
      }

      return true;
    } finally {
      setLeavePhase(null);
      setExportProgress(null);
    }
  }, [hasWhiteboardContent, joinResult.isHost, joinResult.meetingId]);

  const handleWhiteboardStatusChange = React.useCallback(
    (status: "loading" | "ready" | "error") => {
      setWhiteboardViewState(status);
    },
    []
  );

  const handleWhiteboardContentStateChange = React.useCallback((hasContent: boolean) => {
    setHasWhiteboardContent(hasContent);
  }, []);

  const refreshWhiteboardAccess = React.useCallback(async () => {
    if (whiteboardTokenRefreshInFlightRef.current) {
      return whiteboardTokenRefreshInFlightRef.current;
    }

    const refreshPromise = getWhiteboardToken({
      data: {
        meetingId: joinResult.meetingId,
        participantId: joinResult.participantId,
      },
    })
      .then((result) => {
        if (mountedRef.current) {
          setWhiteboardToken(result.token);
          setWhiteboardWsUrl(result.whiteboardUrl);
          setWhiteboardTokenExpiresAt(getJwtExpiryMs(result.token));
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
    joinResult.participantId,
  ]);

  React.useEffect(() => {
    if (joinResult.whiteboardToken) {
      setWhiteboardToken(joinResult.whiteboardToken);
      setWhiteboardTokenExpiresAt(getJwtExpiryMs(joinResult.whiteboardToken));
    }
    if (joinResult.whiteboardUrl) {
      setWhiteboardWsUrl(joinResult.whiteboardUrl);
    }
  }, [joinResult.whiteboardToken, joinResult.whiteboardUrl]);

  const shouldRefreshWhiteboardToken = React.useCallback(() => {
    if (!whiteboardToken || !whiteboardWsUrl) return true;
    if (!whiteboardTokenExpiresAt) return true;
    return Date.now() >= whiteboardTokenExpiresAt - WHITEBOARD_TOKEN_REFRESH_BUFFER_MS;
  }, [whiteboardToken, whiteboardWsUrl, whiteboardTokenExpiresAt]);

  const openWhiteboardInternal = React.useCallback(async (source: "manual" | "auto") => {
    if (!joinResult.whiteboardEnabled) return;

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
    setWhiteboardViewState("loading");
  }, [
    joinResult.whiteboardEnabled,
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
    if (!joinResult.whiteboardEnabled || whiteboardAutoOpenedRef.current) {
      return;
    }

    const autoOpen = async () => {
      whiteboardAutoOpenedRef.current = true;
      await openWhiteboardInternal("auto");
    };

    void autoOpen();
  }, [
    joinResult.whiteboardEnabled,
    openWhiteboardInternal,
  ]);

  return {
    whiteboardToken,
    whiteboardWsUrl,
    whiteboardViewState,
    showWhiteboard,
    setShowWhiteboard,
    openWhiteboard,
    closeWhiteboard,
    handleWhiteboardStatusChange,
    handleWhiteboardContentStateChange,
    exportPdfRef,
    exportSnapshotRef,
    exportChoiceRef,
    leavePhase,
    setLeavePhase,
    exportProgress,
    promptAndExport,
    saveWhiteboardPdfArtifact,
  };
}
