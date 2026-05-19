import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";

import type {
  UploadFileFn,
  ExportSnapshotFn,
} from "../react";
import { MeetingWhiteboard as MeetingWhiteboardImpl } from "../react";
import { WB_ASSET_URLS as WHITEBOARD_ASSET_URLS } from "../generated/wb-asset-urls";
import {
  buildWhiteboardAssetApiPath,
  buildWhiteboardAssetKey,
  buildWhiteboardAssetViewerUrl,
} from "../lib/whiteboard-asset-key";
import { readImageResponseAsFile } from "../lib/import-image";
import { isCanvasAccessRequestEvent, isWhiteboardStateEvent } from "../protocol";
import { deleteWhiteboardAsset, getWhiteboardUploadUrl } from "./server/upload-whiteboard";
import { requestWhiteboardEditAccess, grantWhiteboardEditAccess, denyWhiteboardEditAccess, syncWhiteboardPage, setWhiteboardNavigationController, releaseWhiteboardNavigationController } from "./server/meetings/whiteboard";
import { useResponsive } from "@/lib/hooks/use-responsive";
import type { MeetingWhiteboardHandle, PendingEditorAccessRequest } from "@/lib/meeting/types";

type UploadItem = { id: string; name: string; progress: number | null };

function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

export type { MeetingWhiteboardHandle, PendingEditorAccessRequest };

interface MeetingWhiteboardProps {
  whiteboardUrl: string;
  token: string;
  getWebSocketUri?: () => Promise<string>;
  meetingId: string;
  connectionId: string;
  isHost: boolean;
  onSnapshotReady?: ((exporter: ExportSnapshotFn | null) => void) | null;
  onStatusChange?: (status: "loading" | "ready" | "error") => void;
  onConnectionStatusChange?: (status: "online" | "offline") => void;
  onContentStateChange?: (hasContent: boolean) => void;
  aiEnabled?: boolean;
  aiApiUrl?: string;
  onCustomMessage?: (data: unknown) => void;
  onPendingEditorRequestsChange?: (requests: PendingEditorAccessRequest[]) => void;
}

export const MeetingWhiteboard = forwardRef<MeetingWhiteboardHandle, MeetingWhiteboardProps>(function MeetingWhiteboard({
  whiteboardUrl,
  token,
  getWebSocketUri,
  meetingId,
  connectionId,
  isHost,
  onSnapshotReady,
  onStatusChange,
  onConnectionStatusChange,
  onContentStateChange,
  aiEnabled,
  aiApiUrl,
  onCustomMessage,
  onPendingEditorRequestsChange,
}, ref) {
  const responsive = useResponsive();
  // Use compact bottom-toolbar layout on narrow viewports too (e.g. two browser
  // windows side-by-side on a laptop).  Tablet portrait (640–1024px, taller than
  // wide) is too narrow for the full horizontal toolbar.
  const isPhone = responsive.isPhone || (responsive.isTablet && !responsive.isLandscape);
  const [pendingEditorRequests, setPendingEditorRequests] = useState<PendingEditorAccessRequest[]>([]);
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const whiteboardRef = useRef<MeetingWhiteboardHandle | null>(null);
  const currentPageRef = useRef<number>(1);

  useImperativeHandle(
    ref,
    () => ({
      importExternalImage: async (url: string) => {
        if (!whiteboardRef.current) {
          throw new Error("Whiteboard is not ready");
        }
        await whiteboardRef.current.importExternalImage(url);
      },
      clearPendingRequest: (userId: string) => {
        setPendingEditorRequests((prev) => prev.filter((r) => r.userId !== userId));
      },
      syncCurrentPage: async () => {
        const page = currentPageRef.current;
        if (page < 1) return false;
        try {
          await syncWhiteboardPage({ data: { meetingId, pageNumber: page, connectionId } });
          return true;
        } catch {
          return false;
        }
      },
    }),
    [meetingId, connectionId],
  );

  // Pending requests are received in real-time via WebSocket access messages.
  // No polling needed — see handleCustomMessage below
  
  const handleRequestEditAccess = useCallback(async (): Promise<{ status?: string } | void> => {
    const result = await requestWhiteboardEditAccess({
      data: {
        meetingId,
        connectionId,
      },
    });
    if (!result || typeof result !== "object") return;

    const status = (result as { status?: unknown }).status;
    if (typeof status === "string") {
      return { status };
    }
  }, [meetingId, connectionId]);

  const handleGrantEditAccess = useCallback(async (userId: string) => {
    await grantWhiteboardEditAccess({
      data: {
        meetingId,
        targetUserId: userId,
        connectionId,
      },
    });
    // Remove from local state immediately for better UX
    setPendingEditorRequests((prev) => prev.filter((r) => r.userId !== userId));
  }, [meetingId, connectionId]);

  const handleDenyEditAccessRequest = useCallback(async (userId: string) => {
    await denyWhiteboardEditAccess({
      data: {
        meetingId,
        targetUserId: userId,
        connectionId,
      },
    });
    // Remove from local state immediately for better UX
    setPendingEditorRequests((prev) => prev.filter((r) => r.userId !== userId));
  }, [meetingId, connectionId]);

  const handlePageSync = useCallback(async (pageNumber: number) => {
    currentPageRef.current = pageNumber;
    await syncWhiteboardPage({ data: { meetingId, pageNumber, connectionId } });
  }, [meetingId, connectionId]);

  const handleSetNavigationController = useCallback(async (targetUserId: string) => {
    await setWhiteboardNavigationController({ data: { meetingId, targetUserId, connectionId } });
  }, [meetingId, connectionId]);

  const handleReleaseNavigationController = useCallback(async () => {
    await releaseWhiteboardNavigationController({ data: { meetingId, connectionId } });
  }, [meetingId, connectionId]);

  const uploadFile: UploadFileFn = useCallback(async (file: File) => {
    const uploadId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setUploads(prev => [...prev, { id: uploadId, name: file.name, progress: null }]);

    try {
      const timestamp = Date.now();
      const rand = Math.random().toString(36).slice(2, 8);
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const r2Key = buildWhiteboardAssetKey(meetingId, `${timestamp}-${rand}-${safeName}`);

      const uploadResult = await getWhiteboardUploadUrl({
        data: {
          filename: file.name,
          mimeType: file.type,
          fileSize: file.size,
          r2Key,
          connectionId,
          sessionId: meetingId,
        },
      });
      const { uploadUrl } = uploadResult;
      const assetUrl =
        "assetUrl" in uploadResult && typeof uploadResult.assetUrl === "string"
          ? uploadResult.assetUrl
          : null;

      // Switch from indeterminate to 0% now that the upload is starting
      setUploads(prev => prev.map(u => u.id === uploadId ? { ...u, progress: 0 } : u));

      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.upload.addEventListener("progress", (e) => {
          if (e.lengthComputable) {
            const pct = Math.round((e.loaded / e.total) * 100);
            setUploads(prev => prev.map(u => u.id === uploadId ? { ...u, progress: pct } : u));
          }
        });
        xhr.addEventListener("load", () => {
          if (xhr.status >= 200 && xhr.status < 300) resolve();
          else reject(new Error(`Upload failed: ${xhr.status}`));
        });
        xhr.addEventListener("error", () => reject(new Error("Upload failed")));
        xhr.addEventListener("abort", () => reject(new Error("Upload aborted")));
        xhr.open("PUT", uploadUrl);
        xhr.setRequestHeader("Content-Type", file.type);
        xhr.send(file);
      });

      // Use the canonical server-returned asset URL instead of reverse-engineering
      // the stored object key from the presigned upload URL.
      if (assetUrl) {
        return { url: assetUrl };
      }

      // Backward-compatible fallback for older server responses.
      const uploadedUrl = new URL(uploadUrl);
      const r2Path = uploadedUrl.pathname.split("/").slice(2).join("/"); // strip /{bucket}/
      return { url: buildWhiteboardAssetApiPath(r2Path) };
    } finally {
      setUploads(prev => prev.filter(u => u.id !== uploadId));
    }
  }, [connectionId, meetingId]);

  const resolveAssetUrl = useCallback(
    (src: string) => buildWhiteboardAssetViewerUrl(src, connectionId),
    [connectionId],
  );

  const deleteFile = useCallback(async (url: string) => {
    await deleteWhiteboardAsset({
      data: {
        assetUrl: url,
        connectionId,
        sessionId: meetingId,
      },
    });
  }, [connectionId, meetingId]);

  const fetchExternalImageFile = useCallback(async (url: string) => {
    const proxyUrl = new URL("/api/wiki", window.location.origin);
    proxyUrl.searchParams.set("type", "image-proxy");
    proxyUrl.searchParams.set("imageUrl", url);

    const response = await fetch(proxyUrl.toString(), {
      credentials: "same-origin",
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!response.ok) {
      let message = "Failed to fetch image";
      try {
        const text = await response.text();
        if (text) {
          message = text;
        }
      } catch {
        // Keep generic message
      }
      throw new Error(message);
    }

    return readImageResponseAsFile(response, url);
  }, [token]);

  const handleCustomMessage = useCallback((data: unknown) => {
    if (data && typeof data === "object") {
      const msg = data as Record<string, unknown>;

      if (
        isCanvasAccessRequestEvent(msg.type) &&
        typeof msg.userId === "string" &&
        typeof msg.userName === "string"
      ) {
        const request: PendingEditorAccessRequest = {
          userId: msg.userId,
          userName: msg.userName,
        };
        setPendingEditorRequests((prev) => {
          // Avoid duplicates
          if (prev.some((r) => r.userId === msg.userId)) return prev;
          return [...prev, request];
        });
      }

      if (isWhiteboardStateEvent(msg.type)) {
        const pendingRequestsPayload = Array.isArray(msg.pendingEditorRequests)
          ? msg.pendingEditorRequests
          : Array.isArray(msg.pendingRequests)
            ? msg.pendingRequests
            : [];
        const nextRequests = pendingRequestsPayload.filter(
          (r): r is PendingEditorAccessRequest =>
            !!r &&
            typeof r === "object" &&
            typeof (r as PendingEditorAccessRequest).userId === "string" &&
            typeof (r as PendingEditorAccessRequest).userName === "string"
        );
        setPendingEditorRequests(nextRequests);
      }
    }

    onCustomMessage?.(data);
  }, [onCustomMessage]);

  useEffect(() => {
    onPendingEditorRequestsChange?.(pendingEditorRequests);
  }, [onPendingEditorRequestsChange, pendingEditorRequests]);

  return (
    <div className="relative w-full h-full">
      <MeetingWhiteboardImpl
        ref={whiteboardRef}
        whiteboardUrl={whiteboardUrl}
        token={token}
        getWebSocketUri={getWebSocketUri}
        assetUrls={WHITEBOARD_ASSET_URLS}
        uploadFile={uploadFile}
        deleteFile={deleteFile}
        resolveAssetUrl={resolveAssetUrl}
        fetchExternalImageFile={fetchExternalImageFile}
        onSnapshotReady={onSnapshotReady}
        onRequestEditAccess={handleRequestEditAccess}
        onGrantEditAccess={handleGrantEditAccess}
        onDenyEditAccessRequest={handleDenyEditAccessRequest}
        pendingEditorRequests={pendingEditorRequests}
        isPhone={isPhone}
        onStatusChange={onStatusChange}
        onConnectionStatusChange={onConnectionStatusChange}
        onContentStateChange={onContentStateChange}
        aiEnabled={aiEnabled}
        aiApiUrl={aiApiUrl}
        onCurrentPageChange={(pageNumber) => {
          currentPageRef.current = pageNumber;
        }}
        onPageSync={handlePageSync}
        onSetNavigationController={handleSetNavigationController}
        onReleaseNavigationController={handleReleaseNavigationController}
        onCustomMessage={handleCustomMessage}
        showManagerRequestPanel={!isHost}
      />
      {uploads.length > 0 && (
        <div className="absolute bottom-20 left-4 z-[300] flex flex-col gap-1.5 pointer-events-none">
          {uploads.map((upload) => (
            <div
              key={upload.id}
              className="bg-white/90 backdrop-blur-sm border border-black/[0.06] rounded-lg px-3 py-2 shadow-sm w-48"
            >
              <div className="flex items-center justify-between gap-2 mb-1.5">
                <span className="text-xs text-stone-600 truncate">
                  {upload.name.length > 22 ? `${upload.name.slice(0, 20)}…` : upload.name}
                </span>
                <span className="text-[10px] text-stone-400 shrink-0 tabular-nums">
                  {upload.progress == null ? "…" : `${upload.progress}%`}
                </span>
              </div>
              <div className="h-1 bg-stone-100 rounded-full overflow-hidden">
                {upload.progress == null ? (
                  <div className="h-full w-2/5 bg-teal-400 rounded-full animate-pulse" />
                ) : (
                  <div
                    className={cn(
                      "h-full bg-teal-500 rounded-full transition-all duration-150",
                      upload.progress === 100 && "bg-teal-600"
                    )}
                    style={{ width: `${upload.progress}%` }}
                  />
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
});
