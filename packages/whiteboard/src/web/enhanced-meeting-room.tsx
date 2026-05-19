import * as React from "react";

import {
  MeetingRoomLayout,
  type MeetingExtensions,
} from "@/components/meeting/meeting-room-layout";
import {
  useMeetingRoom,
  type MeetingRoomContentProps,
} from "@/lib/meeting/use-meeting-room";
import type {
  MeetingWhiteboardHandle,
  PendingEditorAccessRequest,
} from "@/lib/meeting/types";
import { logError } from "@/lib/logger-client";
import { markMeetingEntryMetric } from "@/lib/meeting/entry-metrics";
import { useRecorderStagePublisher } from "@/lib/meeting/recorder-stage";
import {
  grantWhiteboardEditAccess,
  denyWhiteboardEditAccess,
} from "./server/meetings/whiteboard";
import { useWhiteboardSession } from "./use-whiteboard-session";
import { preloadMeetingWhiteboardModule } from "./preload-whiteboard";

const LazyWikiSearchPanel = React.lazy(async () => {
  const module = await import("./meeting/wiki-search-panel");
  return { default: module.WikiSearchPanel };
});

const LazyMeetingWhiteboard = React.lazy(async () => {
  const module = await preloadMeetingWhiteboardModule();
  return { default: module.MeetingWhiteboard };
});

class WhiteboardSurfaceErrorBoundary extends React.Component<
  {
    children: React.ReactNode;
    onError: (error: Error) => void;
    resetKey: string;
  },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    logError("[whiteboard] Canvas crashed", error, info.componentStack);
    this.props.onError(error);
  }

  componentDidUpdate(prevProps: { resetKey: string }) {
    if (prevProps.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null });
    }
  }

  render() {
    if (this.state.error) return null;
    return this.props.children;
  }
}

export function MeetingRoomContent(props: MeetingRoomContentProps) {
  const { code, joinResult } = props;
  const whiteboardRef = React.useRef<MeetingWhiteboardHandle | null>(null);
  const latestWhiteboardAuthRef = React.useRef({
    token: joinResult.whiteboardToken ?? null,
    url: joinResult.whiteboardUrl ?? null,
  });
  const [whiteboardRequests, setWhiteboardRequests] = React.useState<
    PendingEditorAccessRequest[]
  >([]);

  const broadcastWikiSearch = React.useCallback(
    (data: Record<string, unknown>) => {
      const { token, url } = latestWhiteboardAuthRef.current;
      if (!url || !token) return;
      fetch(new URL("/broadcast", url).toString(), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ data }),
      }).catch(() => {});
    },
    [],
  );

  const meeting = useMeetingRoom(props, undefined, broadcastWikiSearch);
  const {
    whiteboardToken,
    whiteboardWsUrl,
    getWhiteboardWebSocketUri,
    whiteboardViewState,
    showWhiteboard,
    openWhiteboard,
    closeWhiteboard,
    handleWhiteboardStatusChange,
    handleWhiteboardConnectionStatusChange,
    exportSnapshotRef,
  } = useWhiteboardSession(joinResult, meeting.roomInstance);

  useRecorderStagePublisher({
    room: meeting.roomInstance,
    enabled: meeting.canHostManage,
    stage: meeting.hasScreenShare ? "screen_share" : showWhiteboard ? "whiteboard" : "video",
  });

  React.useEffect(() => {
    latestWhiteboardAuthRef.current = {
      token: whiteboardToken,
      url: whiteboardWsUrl,
    };
  }, [whiteboardToken, whiteboardWsUrl]);

  const handleMeasuredWhiteboardStatusChange = React.useCallback(
    (status: "loading" | "ready" | "error") => {
      handleWhiteboardStatusChange(status);
      if (status === "ready") {
        markMeetingEntryMetric("whiteboardReadyAt", { code });
      }
    },
    [code, handleWhiteboardStatusChange],
  );

  const handleWhiteboardCrash = React.useCallback(
    (_error: Error) => {
      handleWhiteboardStatusChange("error");
    },
    [handleWhiteboardStatusChange],
  );

  const handleApproveWhiteboard = React.useCallback(
    async (userId: string) => {
      try {
        await grantWhiteboardEditAccess({
          data: {
            meetingId: joinResult.meetingId,
            targetUserId: userId,
            connectionId: joinResult.connectionId,
          },
        });
        setWhiteboardRequests((prev) =>
          prev.filter((request) => request.userId !== userId),
        );
        whiteboardRef.current?.clearPendingRequest(userId);
      } catch (err) {
        logError("[Meeting] Failed to grant whiteboard edit access:", err);
        meeting.addToast({
          title: "Approval failed",
          description: "Could not approve whiteboard access. Please try again.",
          data: { variant: "error" },
        });
      }
    },
    [joinResult.meetingId, joinResult.connectionId, meeting.addToast],
  );

  const handleDenyWhiteboard = React.useCallback(
    async (userId: string) => {
      try {
        await denyWhiteboardEditAccess({
          data: {
            meetingId: joinResult.meetingId,
            targetUserId: userId,
            connectionId: joinResult.connectionId,
          },
        });
        setWhiteboardRequests((prev) =>
          prev.filter((request) => request.userId !== userId),
        );
        whiteboardRef.current?.clearPendingRequest(userId);
      } catch (err) {
        logError("[Meeting] Failed to deny whiteboard edit access:", err);
        meeting.addToast({
          title: "Action failed",
          description: "Could not deny whiteboard access. Please try again.",
          data: { variant: "error" },
        });
      }
    },
    [joinResult.meetingId, joinResult.connectionId, meeting.addToast],
  );

  React.useEffect(() => {
    if (!showWhiteboard) {
      setWhiteboardRequests([]);
    }
  }, [showWhiteboard]);

  const handleAddWikiImageToWhiteboard = React.useCallback(
    async (imageUrl: string) => {
      if (!whiteboardRef.current) {
        throw new Error("Open the whiteboard first");
      }
      await whiteboardRef.current.importExternalImage(imageUrl);
    },
    [],
  );

  const [isSyncingWhiteboard, setIsSyncingWhiteboard] = React.useState(false);
  const handleSyncWhiteboard = React.useCallback(async () => {
    if (!whiteboardRef.current || isSyncingWhiteboard) return;
    setIsSyncingWhiteboard(true);
    try {
      const ok = await whiteboardRef.current.syncCurrentPage();
      if (!ok) {
        meeting.addToast({
          title: "Sync failed",
          description: "Could not sync the current whiteboard page. Try again.",
          data: { variant: "error" },
        });
      }
    } catch (err) {
      logError("[Meeting] Failed to sync whiteboard:", err);
      meeting.addToast({
        title: "Sync failed",
        description: "Could not sync the current whiteboard page. Try again.",
        data: { variant: "error" },
      });
    } finally {
      setIsSyncingWhiteboard(false);
    }
  }, [isSyncingWhiteboard, meeting.addToast]);

  const whiteboardRequested = showWhiteboard;
  const whiteboardCanMount =
    showWhiteboard && !!whiteboardToken && !!whiteboardWsUrl;
  const whiteboardReady =
    whiteboardRequested && whiteboardViewState === "ready";
  const whiteboardLoading =
    whiteboardRequested && whiteboardViewState === "loading";
  const whiteboardError =
    whiteboardRequested && whiteboardViewState === "error";
  const whiteboardDisabledByConfig =
    whiteboardRequested && !joinResult.whiteboardEnabled;

  const extensions: MeetingExtensions = {
    surface: {
      show: whiteboardRequested,
      canMount: whiteboardCanMount,
      loading: whiteboardLoading,
      error: whiteboardError,
      disabledByConfig: whiteboardDisabledByConfig,
      disabledReason: joinResult.whiteboardDisabledReason,
      onClose: () => {
        void closeWhiteboard();
      },
      content: (
        <React.Suspense
          fallback={
            <div
              className="flex h-full w-full items-center justify-center"
              style={{ background: "#ffffff" }}
            >
              <div className="text-center">
                <div
                  style={{
                    width: 48,
                    height: 48,
                    borderRadius: 12,
                    background:
                      "linear-gradient(135deg, #f0fdfa 0%, #ccfbf1 100%)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    margin: "0 auto 12px",
                    boxShadow: "0 4px 12px -2px rgba(20,184,166,0.15)",
                  }}
                >
                  <div className="liquid-spinner-light" />
                </div>
                <p className="text-sm font-medium text-stone-500">
                  Preparing canvas...
                </p>
              </div>
            </div>
          }
        >
          {/* Keep the actual tldraw surface mounted and visible whenever it
              exists. The whiteboard component owns its loading/error states. */}
          <div
            className="h-full w-full"
            style={{ background: "#ffffff" }}
          >
            <WhiteboardSurfaceErrorBoundary
              resetKey={`${joinResult.meetingId}:${joinResult.connectionId ?? ""}`}
              onError={handleWhiteboardCrash}
            >
              <LazyMeetingWhiteboard
                ref={whiteboardRef}
                whiteboardUrl={whiteboardWsUrl!}
                token={whiteboardToken!}
                getWebSocketUri={getWhiteboardWebSocketUri}
                meetingId={joinResult.meetingId}
                connectionId={joinResult.connectionId!}
                isHost={meeting.canModerate}
                onSnapshotReady={(fn) => {
                  exportSnapshotRef.current = fn;
                }}
                onStatusChange={handleMeasuredWhiteboardStatusChange}
                onConnectionStatusChange={handleWhiteboardConnectionStatusChange}
                aiEnabled
                aiApiUrl="/api/ai/assistant"
                onCustomMessage={meeting.ui.handleWhiteboardCustomMessage}
                onPendingEditorRequestsChange={setWhiteboardRequests}
              />
            </WhiteboardSurfaceErrorBoundary>
          </div>
        </React.Suspense>
      ),
    },
    surfaceToolbar: {
      active: showWhiteboard,
      onToggle: () => {
        if (!showWhiteboard) {
          void openWhiteboard();
          return;
        }
        void closeWhiteboard({ saveSnapshot: true });
      },
      onSync: handleSyncWhiteboard,
      isSyncing: isSyncingWhiteboard,
      disabled: !joinResult.whiteboardEnabled,
      disabledReason: joinResult.whiteboardDisabledReason,
    },
    extraPermissions: whiteboardRequests.map((request) => ({
      kind: "whiteboard-edit" as const,
      id: `whiteboard-${request.userId}`,
      userId: request.userId,
      userName: request.userName,
    })),
    onApproveExtraPermission: handleApproveWhiteboard,
    onDenyExtraPermission: handleDenyWhiteboard,
    searchPanel: (
      <React.Suspense fallback={null}>
        <LazyWikiSearchPanel
          onClose={() => meeting.ui.setShowSearch(false)}
          triggerQuery={meeting.ui.wikiQuery}
          userName={meeting.currentUserName}
          onAddImageToWhiteboard={whiteboardReady ? handleAddWikiImageToWhiteboard : undefined}
          onBroadcastSearch={meeting.ui.handleWikiBroadcast}
          remoteSearch={meeting.ui.remoteWikiSearch}
          whiteboardToken={whiteboardToken}
        />
      </React.Suspense>
    ),
    onAddImage: whiteboardReady ? handleAddWikiImageToWhiteboard : undefined,
    forceParticipantStrip: showWhiteboard,
  };

  return <MeetingRoomLayout meeting={meeting} extensions={extensions} />;
}
