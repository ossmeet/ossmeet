import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Tldraw, type Editor, type TLAssetStore, type TLFrameShape } from "tldraw";
import { useSync } from "../react";
import { isPageSyncEvent, isWhiteboardStateEvent } from "../protocol";
import { installWhiteboardWebSocketAuth } from "../lib/install-whiteboard-ws-auth";
import { GlowLaserOverlayUtil, GlowCollaboratorLaserOverlayUtil } from "../lib/glow-laser-overlay";
import {
  whiteboardShapeUtils,
  whiteboardSyncShapeUtils,
} from "../lib/whiteboard-shapes";
import { addWhiteboardAssetTokenToViewerUrl } from "../lib/whiteboard-asset-key";
import { applyOssmeetTldrawTheme } from "../lib/tldraw-theme";

installWhiteboardWebSocketAuth();

const RECORDER_CANVAS_STYLE = {
  background: "#ffffff",
};

function isPageFrame(shape: TLFrameShape) {
  return (
    (shape.meta as Record<string, unknown> | undefined)?.isPageFrame === true ||
    shape.props.name?.startsWith("Page ")
  );
}

function getOrderedPageFrames(editor: Editor) {
  return editor
    .getCurrentPageShapes()
    .filter((shape): shape is TLFrameShape => shape.type === "frame")
    .filter(isPageFrame)
    .sort((a, b) => a.y - b.y);
}

function fitEditorToBounds(editor: Editor, bounds: { x: number; y: number; w: number; h: number }) {
  const container = editor.getContainer();
  if (container) {
    editor.updateViewportScreenBounds(container);
  }

  editor.zoomToBounds(bounds, {
    inset: 24,
    animation: { duration: 0 },
    force: true,
  });
}

function focusRecorderPage(editor: Editor, pageNumber: number) {
  const frames = getOrderedPageFrames(editor);
  const frame = frames[Math.max(1, pageNumber) - 1] ?? frames[0];
  if (!frame) return false;

  const bounds = editor.getShapePageBounds(frame.id);
  if (!bounds) return false;

  fitEditorToBounds(editor, bounds);
  return true;
}

export interface RecorderWhiteboardProps {
  whiteboardUrl: string;
  token: string;
  onStatusChange?: (status: "loading" | "ready" | "error") => void;
  onContentStateChange?: (hasContent: boolean) => void;
}

export function RecorderWhiteboard({
  whiteboardUrl,
  token,
  onStatusChange,
  onContentStateChange,
}: RecorderWhiteboardProps) {
  const [editor, setEditor] = useState<Editor | null>(null);
  const requestedPageRef = useRef(1);
  const didInitialFocusRef = useRef(false);
  const syncReadyRef = useRef(false);

  // Use callback-based wsUrl (like MeetingWhiteboard) so the token is not
  // eagerly materialized in a useMemo. The global WS proxy in
  // install-whiteboard-ws-auth.ts moves the token from the query string to
  // Sec-WebSocket-Protocol before the connection is opened.
  const tokenRef = useRef(token);
  tokenRef.current = token;

  const wsUrl = useCallback(() => {
    const url = new URL("/connect", whiteboardUrl);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.hash = new URLSearchParams({ token: tokenRef.current }).toString();
    return url.toString();
  }, [whiteboardUrl]);

  const handleCustomMessage = useCallback((data: unknown) => {
    if (!data || typeof data !== "object") return;
    const msg = data as Record<string, unknown>;
    const pageNumber =
      typeof msg.pageNumber === "number" && Number.isFinite(msg.pageNumber)
        ? Math.max(1, Math.trunc(msg.pageNumber))
        : null;

    if (!pageNumber) return;
    if (!isPageSyncEvent(msg.type) && !isWhiteboardStateEvent(msg.type)) return;

    requestedPageRef.current = pageNumber;
    if (!editor || !syncReadyRef.current) return;

    requestAnimationFrame(() => {
      focusRecorderPage(editor, pageNumber);
    });
  }, [editor]);

  const assetStore = useMemo<TLAssetStore>(() => ({
    upload: async () => ({ src: "" }),
    resolve: (asset) => addWhiteboardAssetTokenToViewerUrl(asset.props.src ?? "", tokenRef.current) || null,
  }), []);

  // Use useSync directly — useWhiteboardSync blocks the connection until
  // `users` is non-undefined (needed for collaborative editing), but the
  // recorder has no user identity and must connect immediately.
  const sync = useSync({
    uri: wsUrl,
    assets: assetStore,
    shapeUtils: whiteboardSyncShapeUtils,
    onCustomMessageReceived: handleCustomMessage,
  });

  const syncReady = sync.status === "synced-remote";
  const isError = sync.status === "error";
  syncReadyRef.current = syncReady;

  useEffect(() => {
    didInitialFocusRef.current = false;
  }, [editor]);

  const components = useMemo(
    () => ({
      Toolbar: null,
      InFrontOfTheCanvas: null,
      PageMenu: null,
      Minimap: null,
      NavigationPanel: null,
      StylePanel: null,
      MainMenu: null,
      ActionsMenu: null,
      QuickActions: null,
      HelpMenu: null,
      ZoomMenu: null,
      SharePanel: null,
      LoadingScreen: null,
      ErrorFallback: () => null,
    }),
    []
  );

  useEffect(() => {
    if (!onStatusChange) return;
    if (isError) { onStatusChange("error"); return; }
    if (syncReady) { onStatusChange("ready"); return; }
    onStatusChange("loading");
  }, [isError, syncReady, onStatusChange]);

  useEffect(() => {
    if (!editor || !onContentStateChange) return;
    const notify = () => {
      const hasContent = editor.getCurrentPageShapes().some((s) => s.type !== "frame");
      onContentStateChange(hasContent);
    };
    notify();
    const unsub = editor.store.listen(notify, { scope: "document" });
    return () => {
      unsub();
      onContentStateChange(false);
    };
  }, [editor, onContentStateChange]);

  useEffect(() => {
    if (!editor) return;
    applyOssmeetTldrawTheme(editor);
    editor.updateInstanceState({ isDebugMode: false });
    editor.setCurrentTool("hand");
  }, [editor]);

  useEffect(() => {
    if (!editor || !syncReady || didInitialFocusRef.current) return;

    const focus = () => {
      didInitialFocusRef.current = focusRecorderPage(editor, requestedPageRef.current);
    };
    const rafId = requestAnimationFrame(focus);
    const settleTimers = [80, 180, 360, 700].map((delay) =>
      window.setTimeout(() => {
        if (!didInitialFocusRef.current) focus();
      }, delay)
    );

    return () => {
      cancelAnimationFrame(rafId);
      settleTimers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [editor, syncReady]);

  // mutation moved to useEffect to avoid side effects during render
  const tldrawStoreRaw = syncReady ? sync.store : null;
  const lastValidStoreRef = useRef(tldrawStoreRaw);
  useEffect(() => {
    if (tldrawStoreRaw) {
      lastValidStoreRef.current = tldrawStoreRaw;
    }
  }, [tldrawStoreRaw]);
  const tldrawStore = lastValidStoreRef.current ?? undefined;

  if (isError) return null;

  // Don't mount tldraw until the synced store is available.
  // Mounting with undefined store then switching to sync.store causes an
  // editor remount that races with viewport measurement in headless Chrome,
  // resulting in a tiny whiteboard and missing drawings in recordings.
  if (!tldrawStore) {
    return <div className="h-full w-full" />;
  }

  return (
    <div className="h-full w-full" style={RECORDER_CANVAS_STYLE}>
      <Tldraw
        store={tldrawStore}
        onMount={setEditor}
        hideUi={true}
        components={components}
        shapeUtils={whiteboardShapeUtils}
        overlayUtils={[GlowLaserOverlayUtil, GlowCollaboratorLaserOverlayUtil]}
        licenseKey={import.meta.env.VITE_TLDRAW_LICENSE_KEY || undefined}
      />
    </div>
  );
}
