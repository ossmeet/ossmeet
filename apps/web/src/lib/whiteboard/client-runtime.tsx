import * as React from "react";
import type { MeetingWhiteboardHandle, PendingWriteRequest } from "@/lib/meeting/types";

export type UploadFileFn = (file: File) => Promise<{ url: string }>;
export type ExportPdfProgressFn = (current: number, total: number) => void;

export interface ExportPdfOptions {
  onProgress?: ExportPdfProgressFn;
  download?: boolean;
}

export type ExportPdfFn = (
  options?: ExportPdfOptions | ExportPdfProgressFn
) => Promise<Blob | null>;

export type ExportSnapshotFn = () => Promise<Blob>;

export interface MeetingWhiteboardProps {
  whiteboardUrl: string;
  token: string;
  assetUrls?: Record<string, unknown>;
  uploadFile?: UploadFileFn;
  fetchExternalImageFile?: (url: string) => Promise<File>;
  onExportReady?: ((exporter: ExportPdfFn | null) => void) | null;
  onSnapshotReady?: ((exporter: ExportSnapshotFn | null) => void) | null;
  onRequestWriteAccess?: () => Promise<{ status?: string } | void>;
  onApproveWriter?: (userId: string) => Promise<void>;
  onDenyWriter?: (userId: string) => Promise<void>;
  pendingRequests?: PendingWriteRequest[];
  isPhone?: boolean;
  onStatusChange?: (status: "loading" | "ready" | "error") => void;
  onContentStateChange?: (hasContent: boolean) => void;
  aiEnabled?: boolean;
  aiApiUrl?: string;
  onPageSync?: (pageNumber: number) => Promise<void>;
  onSetPresenter?: (targetUserId: string) => Promise<void>;
  onReleasePresenter?: () => Promise<void>;
  onCustomMessage?: (data: unknown) => void;
  showHostRequestPanel?: boolean;
}

export interface RecorderWhiteboardProps {
  whiteboardUrl: string;
  token: string;
  onStatusChange?: (status: "loading" | "ready" | "error") => void;
  onContentStateChange?: (hasContent: boolean) => void;
}

export const WHITEBOARD_ASSET_URLS: Record<string, unknown> = {};

function useUnavailableWhiteboardState(
  onStatusChange?: (status: "loading" | "ready" | "error") => void,
  onContentStateChange?: (hasContent: boolean) => void
) {
  React.useEffect(() => {
    onStatusChange?.("error");
    onContentStateChange?.(false);
  }, [onContentStateChange, onStatusChange]);
}

export const MeetingWhiteboard = React.forwardRef<
  MeetingWhiteboardHandle,
  MeetingWhiteboardProps
>(function MeetingWhiteboardUnavailable(props, ref) {
  useUnavailableWhiteboardState(props.onStatusChange, props.onContentStateChange);

  React.useEffect(() => {
    props.onExportReady?.(null);
    props.onSnapshotReady?.(null);
  }, [props.onExportReady, props.onSnapshotReady]);

  React.useImperativeHandle(ref, () => ({
    importExternalImage: async () => {},
    clearPendingRequest: () => {},
    syncCurrentPage: async () => false,
  }));

  return null;
});

export function RecorderWhiteboard(props: RecorderWhiteboardProps) {
  useUnavailableWhiteboardState(props.onStatusChange, props.onContentStateChange);
  return null;
}
