import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import "@/lib/whiteboard/client-runtime.css";
import type {
  UploadFileFn,
  ExportPdfFn,
  ExportSnapshotFn,
} from "@/lib/whiteboard/client-runtime";
import {
  MeetingWhiteboard as MeetingWhiteboardImpl,
  WHITEBOARD_ASSET_URLS,
} from "@/lib/whiteboard/client-runtime";
import { buildWhiteboardAssetKey } from "@/lib/whiteboard-asset-key";
import { getWhiteboardUploadUrl } from "@/server/upload";
import { requestWhiteboardWrite, approveWhiteboardWrite, denyWhiteboardWrite, syncWhiteboardPage, setWhiteboardPresenter, releaseWhiteboardPresenter } from "@/server/meetings/whiteboard";
import { useResponsive } from "@/lib/hooks/use-responsive";
import type { MeetingWhiteboardHandle, PendingWriteRequest } from "@/lib/meeting/types";

export type { MeetingWhiteboardHandle, PendingWriteRequest };

interface MeetingWhiteboardProps {
  whiteboardUrl: string;
  token: string;
  meetingId: string;
  participantId: string;
  isHost: boolean;
  onExportReady?: ((exporter: ExportPdfFn | null) => void) | null;
  onSnapshotReady?: ((exporter: ExportSnapshotFn | null) => void) | null;
  onStatusChange?: (status: "loading" | "ready" | "error") => void;
  onContentStateChange?: (hasContent: boolean) => void;
  aiEnabled?: boolean;
  aiApiUrl?: string;
  onCustomMessage?: (data: unknown) => void;
  onPendingRequestsChange?: (requests: PendingWriteRequest[]) => void;
}

export const MeetingWhiteboard = forwardRef<MeetingWhiteboardHandle, MeetingWhiteboardProps>(function MeetingWhiteboard({
  whiteboardUrl,
  token,
  meetingId,
  participantId,
  isHost,
  onExportReady,
  onSnapshotReady,
  onStatusChange,
  onContentStateChange,
  aiEnabled,
  aiApiUrl,
  onCustomMessage,
  onPendingRequestsChange,
}, ref) {
  const responsive = useResponsive();
  // Use compact bottom-toolbar layout on narrow viewports too (e.g. two browser
  // windows side-by-side on a laptop).  Tablet portrait (640–1024px, taller than
  // wide) is too narrow for the full horizontal toolbar.
  const isPhone = responsive.isPhone || (responsive.isTablet && !responsive.isLandscape);
  const [pendingRequests, setPendingRequests] = useState<PendingWriteRequest[]>([]);
  const whiteboardRef = useRef<MeetingWhiteboardHandle | null>(null);
  const currentPageRef = useRef<number | null>(null);

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
        setPendingRequests((prev) => prev.filter((r) => r.userId !== userId));
      },
      syncCurrentPage: async () => {
        const page = currentPageRef.current;
        if (!page || page < 1) return false;
        try {
          await syncWhiteboardPage({ data: { meetingId, pageNumber: page, participantId } });
          return true;
        } catch {
          return false;
        }
      },
    }),
    [meetingId, participantId],
  );

  // Pending requests are received in real-time via WebSocket (writer.request messages)
  // No polling needed — see handleCustomMessage below
  
  const handleRequestWriteAccess = useCallback(async (): Promise<{ status?: string } | void> => {
    const result = await requestWhiteboardWrite({
      data: {
        meetingId,
        participantId,
      },
    });
    if (!result || typeof result !== "object") return;

    const status = (result as { status?: unknown }).status;
    if (typeof status === "string") {
      return { status };
    }
  }, [meetingId, participantId]);

  const handleApproveWriter = useCallback(async (userId: string) => {
    await approveWhiteboardWrite({
      data: {
        meetingId,
        targetUserId: userId,
        participantId,
      },
    });
    // Remove from local state immediately for better UX
    setPendingRequests((prev) => prev.filter((r) => r.userId !== userId));
  }, [meetingId, participantId]);

  const handleDenyWriter = useCallback(async (userId: string) => {
    await denyWhiteboardWrite({
      data: {
        meetingId,
        targetUserId: userId,
        participantId,
      },
    });
    // Remove from local state immediately for better UX
    setPendingRequests((prev) => prev.filter((r) => r.userId !== userId));
  }, [meetingId, participantId]);

  const handlePageSync = useCallback(async (pageNumber: number) => {
    currentPageRef.current = pageNumber;
    await syncWhiteboardPage({ data: { meetingId, pageNumber, participantId } });
  }, [meetingId, participantId]);

  const handleSetPresenter = useCallback(async (targetUserId: string) => {
    await setWhiteboardPresenter({ data: { meetingId, targetUserId, participantId } });
  }, [meetingId, participantId]);

  const handleReleasePresenter = useCallback(async () => {
    await releaseWhiteboardPresenter({ data: { meetingId, participantId } });
  }, [meetingId, participantId]);

  const uploadFile: UploadFileFn = useCallback(async (file: File) => {
    const timestamp = Date.now();
    const rand = Math.random().toString(36).slice(2, 8);
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const r2Key = buildWhiteboardAssetKey(meetingId, `${timestamp}-${rand}-${safeName}`);

    const { uploadUrl } = await getWhiteboardUploadUrl({
      data: {
        filename: file.name,
        mimeType: file.type,
        fileSize: file.size,
        r2Key,
        participantId,
        sessionId: meetingId,
      },
    });

    const uploadResponse = await fetch(uploadUrl, {
      method: "PUT",
      headers: {
        "Content-Type": file.type,
        "Content-Length": String(file.size),
      },
      body: file,
    });

    if (!uploadResponse.ok) {
      throw new Error(`Upload failed: ${uploadResponse.status}`);
    }

    // The presigned URL stores the file under uploads/{userId}/wb/{meetingId}/{timestamp}-{name}
    // or uploads/guest-{participantId}/wb/{meetingId}/{timestamp}-{name} for guests
    // Serve it through our API route which reads from R2
    const uploadedUrl = new URL(uploadUrl);
    const r2Path = uploadedUrl.pathname.split("/").slice(2).join("/"); // strip /{bucket}/
    return { url: `/api/wb-assets/${r2Path}` };
  }, [participantId, meetingId]);

  const fetchExternalImageFile = useCallback(async (url: string) => {
    const proxyUrl = new URL("/api/wiki", window.location.origin);
    proxyUrl.searchParams.set("type", "image-proxy");
    proxyUrl.searchParams.set("imageUrl", url);

    const response = await fetch(proxyUrl.toString(), {
      credentials: "same-origin",
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

    const contentType = response.headers.get("content-type");
    if (!contentType?.startsWith("image/")) {
      throw new Error("URL does not point to an image");
    }

    const blob = await response.blob();
    const pathname = new URL(url).pathname;
    const filename = decodeURIComponent(pathname.split("/").pop() || "").trim() || "external-image";
    return new File([blob], filename, { type: contentType });
  }, []);

  const handleCustomMessage = useCallback((data: unknown) => {
    if (isHost && data && typeof data === "object") {
      const msg = data as Record<string, unknown>;

      if (
        msg.type === "writer.request" &&
        typeof msg.userId === "string" &&
        typeof msg.userName === "string"
      ) {
        const request: PendingWriteRequest = {
          userId: msg.userId,
          userName: msg.userName,
        };
        setPendingRequests((prev) => {
          // Avoid duplicates
          if (prev.some((r) => r.userId === msg.userId)) return prev;
          return [...prev, request];
        });
      }

      if (msg.type === "writer_state" && Array.isArray(msg.pendingRequests)) {
        const nextRequests = msg.pendingRequests.filter(
          (r): r is PendingWriteRequest =>
            !!r &&
            typeof r === "object" &&
            typeof (r as PendingWriteRequest).userId === "string" &&
            typeof (r as PendingWriteRequest).userName === "string"
        );
        setPendingRequests(nextRequests);
      }
    }

    onCustomMessage?.(data);
  }, [isHost, onCustomMessage]);

  useEffect(() => {
    onPendingRequestsChange?.(pendingRequests);
  }, [onPendingRequestsChange, pendingRequests]);

  return (
    <>
      <MeetingWhiteboardImpl
        ref={whiteboardRef}
        whiteboardUrl={whiteboardUrl}
        token={token}
        assetUrls={WHITEBOARD_ASSET_URLS}
        uploadFile={uploadFile}
        fetchExternalImageFile={fetchExternalImageFile}
        onExportReady={onExportReady}
        onSnapshotReady={onSnapshotReady}
        onRequestWriteAccess={handleRequestWriteAccess}
        onApproveWriter={handleApproveWriter}
        onDenyWriter={handleDenyWriter}
        pendingRequests={pendingRequests}
        isPhone={isPhone}
        onStatusChange={onStatusChange}
        onContentStateChange={onContentStateChange}
        aiEnabled={aiEnabled}
        aiApiUrl={aiApiUrl}
        onPageSync={handlePageSync}
        onSetPresenter={isHost ? handleSetPresenter : undefined}
        onReleasePresenter={handleReleasePresenter}
        onCustomMessage={handleCustomMessage}
        showHostRequestPanel={false}
      />
    </>
  );
});
