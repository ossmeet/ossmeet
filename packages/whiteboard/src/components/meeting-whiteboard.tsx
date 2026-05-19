import {
  forwardRef,
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Tldraw,
  type Editor,
  type TLAssetStore,
  type TldrawOptions,
  AssetRecordType,
  Box,
  defaultHandleExternalUrlContent,
  getHashForString,
  useEditor,
  type TLUserStore,
} from "tldraw";
import { computed } from "@tldraw/state";
import { createUserId, UserRecordType } from "@tldraw/tlschema";
import { GlowLaserOverlayUtil, GlowCollaboratorLaserOverlayUtil } from "../lib/glow-laser-overlay";
import { filterSupportedImageFiles } from "../lib/whiteboard-image";
import { useWhiteboardSync } from "../react";
import {
  WhiteboardCanvasOverlays,
  WhiteboardToolbarContext,
  WhiteboardToolbar,
} from "./whiteboard-toolbar";
import { WhiteboardViewportControls } from "./whiteboard-viewport-controls";
import { PageShadows } from "./page-shadows";
import { useWhiteboardAssistant } from "../lib/ai/use-whiteboard-assistant";

import { WHITEBOARD_IMPORT_ERROR_EVENT } from "../lib/import-error-event";
import { useWhiteboardPages } from "../lib/use-whiteboard-pages";
import { usePageImagePreloader } from "../lib/use-page-image-preloader";
import { useWhiteboardResponsive } from "../lib/use-whiteboard-responsive";
import {
  deriveNavigationState,
  normalizeSyncedPageNumber,
} from "../lib/navigation-sync";
import {
  WHITEBOARD_EVENTS,
  isCanvasAccessDeniedEvent,
  isCanvasAccessGrantedEvent,
  isCanvasAccessRevokedEvent,
  isPageSyncEvent,
  isWhiteboardStateEvent,
} from "../protocol";
import { installWhiteboardWebSocketAuth } from "../lib/install-whiteboard-ws-auth";
import { installCanvasTransformGuard } from "../lib/install-canvas-transform-guard";
import {
  registerShapeParentingSideEffect,
  reparentOrphanedShapes,
} from "../lib/shape-parenting";
import { registerPageFrameProtection } from "../lib/protect-page-frames";
import {
  registerTextNormalization,
  whiteboardTipTapExtensions,
} from "../lib/normalize-rich-text-math";
import { StrokeEraserTool } from "../lib/stroke-eraser-tool";
import { ScreenshotTool, setScreenshotUploadFile } from "../lib/screenshot-tool";
import { TableTool } from "../lib/table-tool";
import {
  whiteboardShapeUtils,
  whiteboardSyncShapeUtils,
} from "../lib/whiteboard-shapes";
import { applyOssmeetTldrawTheme } from "../lib/tldraw-theme";

// Stable arrays — defined outside component to prevent tldraw remount
const whiteboardTools = [StrokeEraserTool, ScreenshotTool, TableTool];
const LazyWhiteboardAssistant = lazy(async () => {
  const module = await import("./whiteboard-assistant-panel");
  return { default: module.WhiteboardAssistant };
});
const PEN_MODE_TOOL_IDS = new Set(["draw", "highlight", "eraser", "stroke-eraser", "laser"]);

installWhiteboardWebSocketAuth();
installCanvasTransformGuard();

const MAX_SAFE_VIEWPORT_DIMENSION = 8192;
const MAX_SAFE_CAMERA_TRANSLATE = 1_000_000;

function clampFinite(value: number, min: number, max: number, fallback: number) {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function userColorForId(userId: string): string {
  const palette = [
    "#0f766e",
    "#2563eb",
    "#7c3aed",
    "#c2410c",
    "#be123c",
    "#047857",
    "#0369a1",
    "#a16207",
  ];
  let hash = 0;
  for (let i = 0; i < userId.length; i += 1) {
    hash = (hash * 31 + userId.charCodeAt(i)) | 0;
  }
  return palette[Math.abs(hash) % palette.length] ?? palette[0];
}

function WhiteboardBoundsStabilizer() {
  const editor = useEditor();

  useEffect(() => {
    const container = editor.getContainer();
    let rafId = 0;

    const syncBounds = () => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        // Don't shift the coordinate space mid-stroke — a bounds update while the
        // user is drawing causes a coordinate jump that produces an accidental line
        // segment at the wrong position. The pointerup bubble listener below will
        // flush any deferred sync once the stroke ends.
        if (editor.inputs.getIsPointing() || editor.inputs.getIsDragging()) return;
        editor.updateViewportScreenBounds(container);
      });
    };

    // The meeting shell animates and resizes the whiteboard pane as side rails,
    // participant strips, and safe-area padding change. Keep tldraw's viewport
    // bounds tied to the editor container, not the transformed .tl-canvas layer.
    syncBounds();
    const burstFrames = [1, 2, 4, 8, 16, 32];
    const burstTimers = burstFrames.map((frame) =>
      window.setTimeout(syncBounds, frame * 16)
    );

    const resizeObserver =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(syncBounds)
        : null;
    resizeObserver?.observe(container);

    const pointerSync = () => {
      editor.updateViewportScreenBounds(container);
    };

    const doc = container.ownerDocument;
    const win = doc.defaultView ?? window;
    win.addEventListener("resize", syncBounds);
    win.visualViewport?.addEventListener("resize", syncBounds);
    win.visualViewport?.addEventListener("scroll", syncBounds);
    doc.addEventListener("pointerdown", pointerSync, { capture: true });
    // Bubble (not capture) so tldraw has already processed pointerup and isPointing is false,
    // allowing syncBounds to flush any deferred update from mid-stroke layout changes.
    doc.addEventListener("pointerup", syncBounds);
    doc.addEventListener("pointercancel", syncBounds);
    doc.addEventListener("transitionend", syncBounds, { capture: true });
    doc.addEventListener("animationend", syncBounds, { capture: true });

    return () => {
      cancelAnimationFrame(rafId);
      burstTimers.forEach((timer) => window.clearTimeout(timer));
      resizeObserver?.disconnect();
      win.removeEventListener("resize", syncBounds);
      win.visualViewport?.removeEventListener("resize", syncBounds);
      win.visualViewport?.removeEventListener("scroll", syncBounds);
      doc.removeEventListener("pointerdown", pointerSync, { capture: true });
      doc.removeEventListener("pointerup", syncBounds);
      doc.removeEventListener("pointercancel", syncBounds);
      doc.removeEventListener("transitionend", syncBounds, { capture: true });
      doc.removeEventListener("animationend", syncBounds, { capture: true });
    };
  }, [editor]);

  return null;
}

function WhiteboardPenModeBridge() {
  const editor = useEditor();

  useEffect(() => {
    const clearPenModeForTouchTools = () => {
      const instanceState = editor.getInstanceState();
      if (!instanceState.isPenMode) return;
      if (PEN_MODE_TOOL_IDS.has(editor.getCurrentToolId())) return;
      if (editor.inputs.getIsPointing() || editor.inputs.getIsDragging()) return;

      editor.updateInstanceState({ isPenMode: false });
    };

    clearPenModeForTouchTools();
    return editor.store.listen(clearPenModeForTouchTools, { scope: "session" });
  }, [editor]);

  return null;
}

export type UploadFileFn = (file: File) => Promise<{ url: string }>;
export type ExportSnapshotFn = () => Promise<Blob>;

export interface MeetingWhiteboardHandle {
  importExternalImage: (url: string) => Promise<void>;
}

export interface MeetingWhiteboardProps {
  whiteboardUrl: string;
  token: string;
  getWebSocketUri?: () => Promise<string>;
  assetUrls?: Record<string, unknown>;
  uploadFile?: UploadFileFn;
  deleteFile?: (url: string) => Promise<void>;
  resolveAssetUrl?: (src: string) => string;
  fetchExternalImageFile?: (url: string) => Promise<File>;
  onSnapshotReady?: ((exporter: ExportSnapshotFn | null) => void) | null;
  onRequestEditAccess?: () => Promise<{ status?: string } | void>;
  onGrantEditAccess?: (userId: string) => Promise<void>;
  onDenyEditAccessRequest?: (userId: string) => Promise<void>;
  pendingEditorRequests?: PendingEditorAccessRequest[];
  isPhone?: boolean;
  onStatusChange?: (status: "loading" | "ready" | "error") => void;
  onConnectionStatusChange?: (status: "online" | "offline") => void;
  onContentStateChange?: (hasContent: boolean) => void;
  aiEnabled?: boolean;
  aiApiUrl?: string;
  /** Called when host adds a new page — should sync all participants to it */
  onPageSync?: (pageNumber: number) => Promise<void>;
  onCurrentPageChange?: (pageNumber: number) => void;
  /** Manager-only: designate a connected participant as the active navigation controller */
  onSetNavigationController?: (targetUserId: string) => Promise<void>;
  /** Manager or current navigation controller: release navigation control */
  onReleaseNavigationController?: () => Promise<void>;
  /** Receives all custom messages from the whiteboard server (for forwarding to parent) */
  onCustomMessage?: (data: unknown) => void;
  showManagerRequestPanel?: boolean;
}

interface PendingEditorAccessRequest {
  userId: string;
  userName: string;
}

type ClipboardPasteInfo = {
  content: {
    type: string;
    files?: File[];
  };
};
type BeforePasteInfo = Parameters<
  NonNullable<TldrawOptions["onBeforePasteFromClipboard"]>
>[0];

export const MeetingWhiteboard = forwardRef<
  MeetingWhiteboardHandle,
  MeetingWhiteboardProps
>(function MeetingWhiteboard({
  whiteboardUrl,
  token,
  getWebSocketUri,
  assetUrls,
  uploadFile,
  deleteFile,
  resolveAssetUrl,
  fetchExternalImageFile,
  onSnapshotReady,
  onRequestEditAccess,
  onGrantEditAccess,
  onDenyEditAccessRequest,
  pendingEditorRequests: externalPendingEditorRequests,
  isPhone,
  onStatusChange,
  onConnectionStatusChange,
  onContentStateChange,
  aiEnabled,
  aiApiUrl,
  onPageSync,
  onCurrentPageChange,
  onSetNavigationController,
  onReleaseNavigationController,
  onCustomMessage,
  showManagerRequestPanel = true,
}, ref) {
  const [editor, setEditorState] = useState<Editor | null>(null);

  // guard async setState calls after unmount
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // Stable ref to the current editor — used in asset store callbacks that
  // are constructed before onMount fires (e.g. assetStore.remove).
  const editorRef = useRef<Editor | null>(null);

  const setEditor = useCallback((ed: Editor) => {
    editorRef.current = ed;
    const originalUpdateViewportScreenBounds = ed.updateViewportScreenBounds.bind(ed);
    ed.updateViewportScreenBounds = (screenBounds: Box | HTMLElement, center?: boolean) => {
      let safeBounds = screenBounds;
      if (!(screenBounds instanceof Box)) {
        const rect = screenBounds.getBoundingClientRect();
        const fallbackWidth =
          screenBounds.clientWidth || window.visualViewport?.width || window.innerWidth || 1;
        const fallbackHeight =
          screenBounds.clientHeight || window.visualViewport?.height || window.innerHeight || 1;
        safeBounds = new Box(
          Number.isFinite(rect.left) ? rect.left : 0,
          Number.isFinite(rect.top) ? rect.top : 0,
          clampFinite(rect.width, 1, MAX_SAFE_VIEWPORT_DIMENSION, fallbackWidth),
          clampFinite(rect.height, 1, MAX_SAFE_VIEWPORT_DIMENSION, fallbackHeight)
        );
      } else {
        safeBounds = new Box(
          Number.isFinite(screenBounds.x) ? screenBounds.x : 0,
          Number.isFinite(screenBounds.y) ? screenBounds.y : 0,
          clampFinite(screenBounds.w, 1, MAX_SAFE_VIEWPORT_DIMENSION, 1),
          clampFinite(screenBounds.h, 1, MAX_SAFE_VIEWPORT_DIMENSION, 1)
        );
      }

      const result = originalUpdateViewportScreenBounds(safeBounds, center);
      const camera = ed.getCamera();
      const needsCameraReset =
        !Number.isFinite(camera.x) ||
        !Number.isFinite(camera.y) ||
        !Number.isFinite(camera.z) ||
        Math.abs(camera.x) > MAX_SAFE_CAMERA_TRANSLATE ||
        Math.abs(camera.y) > MAX_SAFE_CAMERA_TRANSLATE;

      if (needsCameraReset) {
        ed.setCamera(
          {
            x: 0,
            y: 0,
            z: clampFinite(camera.z, 0.05, 4, 1),
          },
          { animation: { duration: 0 } }
        );
      }

      return result;
    };
    applyOssmeetTldrawTheme(ed);
    setEditorState(ed);
  }, []);

  // Null editorRef on unmount so stale asset-store callbacks don't fire.
  // setEditor (the onMount callback) handles setting the ref on new instances.
  useEffect(() => () => { editorRef.current = null; }, []);

  const defaultUrlHandlerOpts = useMemo(
    () =>
      ({
        toasts: {
          addToast: () => "ossmeet-url-fallback",
          removeToast: () => "ossmeet-url-fallback",
          clearToasts: () => undefined,
          toasts: [],
        },
        msg: (id?: string) => id ?? "",
      }) as unknown as Parameters<typeof defaultHandleExternalUrlContent>[2],
    []
  );

  // Decode JWT synchronously so userIdRef is populated before any WebSocket
  // messages (e.g. whiteboard.state) arrive via onCustomMessageReceived.
  // Previously this was done in a useEffect, which caused a race condition:
  // the WS connection fires whiteboard.state before React runs the effect, so
  // userIdRef.current was null and rejoining participants didn't see their
  // existing canvas edit access.
  const jwtDecoded = useMemo(() => {
    try {
      const parts = token.split(".");
      if (parts.length === 3) {
        const payload = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
        return {
          userId: (payload.sub as string) ?? null,
          userName: (payload.name as string) ?? "",
          isHost: payload.role === "host",
        };
      }
    } catch (err) {
      console.error("[WB] Failed to decode JWT:", err);
    }
    return { userId: null, userName: "", isHost: false };
  }, [token]);

  const isHost = jwtDecoded.isHost;
  // Stable ref so handleCustomMessage always reads the latest value without
  // needing isHost in its dependency array (which would recreate the callback
  // on every token rotation).
  const isHostRef = useRef(isHost);
  isHostRef.current = isHost;

  const users = useMemo<TLUserStore | undefined>(() => {
    if (!jwtDecoded.userId || typeof window === "undefined") return undefined;
    const rawUserId = jwtDecoded.userId;
    const displayName = jwtDecoded.userName || "User";
    const userId = createUserId(rawUserId);
    return {
      currentUser: computed(`ossmeet-current-user:${rawUserId}`, () =>
        UserRecordType.create({
          id: userId,
          name: displayName,
          color: userColorForId(rawUserId),
        })
      ),
    };
  }, [jwtDecoded.userId, jwtDecoded.userName]);
  const [canEditCanvas, setCanEditCanvas] = useState(isHost);
  const [editAccessRequested, setEditAccessRequested] = useState(false);
  const [navigationControllerUserId, setNavigationControllerUserId] = useState<string | null>(null);
  const [navigationControllerName, setNavigationControllerName] = useState<string | null>(null);
  const [actingManagerId, setActingManagerId] = useState<string | null>(null);
  const [connectedUsers, setConnectedUsers] = useState<{ userId: string; userName: string }[]>([]);
  const userIdRef = useRef<string | null>(jwtDecoded.userId);
  const userNameRef = useRef<string>(jwtDecoded.userName);
  const changePageRef = useRef<(pageNumber: number) => void>(() => {});
  const changePageReadyRef = useRef(false);
  const pageCountRef = useRef(0);
  // Tracks the last page number received from a remote page.sync broadcast.
  // Used to suppress re-broadcasting when a navigation controller's local page change was
  // triggered by following a remote sync rather than their own navigation.
  const remotePageSyncRef = useRef<number | null>(null);
  const pendingRemotePageRef = useRef<number | null>(null);
  const hasAppliedInitialServerPageRef = useRef(false);

  // Keep refs in sync when token changes (reconnect/re-token)
  userIdRef.current = jwtDecoded.userId;
  userNameRef.current = jwtDecoded.userName;
  // Stable ref for the latest token for asset resolution and other
  // auth-dependent side channels outside the websocket handshake.
  const tokenRef = useRef(token);
  tokenRef.current = token;

  // Use external pending requests if provided, otherwise maintain local state
  const pendingEditorRequests = externalPendingEditorRequests ?? [];
  const canUseAssistant = !!aiEnabled && !!aiApiUrl;

  const applyRemotePageSync = useCallback((value: unknown, options?: { initial?: boolean }) => {
    const pageNumber = normalizeSyncedPageNumber(value);
    if (!pageNumber) return;
    if (options?.initial) {
      hasAppliedInitialServerPageRef.current = true;
    }

    remotePageSyncRef.current = pageNumber;
    const pageCount = pageCountRef.current;
    if (changePageReadyRef.current && pageCount > 0 && pageNumber <= pageCount) {
      pendingRemotePageRef.current = null;
      changePageRef.current(pageNumber);
      return;
    }

    pendingRemotePageRef.current = pageNumber;
  }, []);

  useEffect(() => {
    if (isHost) {
      setCanEditCanvas(true);
      setEditAccessRequested(false);
    }
  }, [isHost]);

  // AI assistant hook — owned here so broadcasts can be wired to onCustomMessageReceived.
  // Once a canvas editor opens the shared panel, any active participant can send AI queries.
  const assistant = useWhiteboardAssistant({
    editor,
    apiUrl: aiApiUrl || "/api/ai/assistant",
    whiteboardUrl: aiEnabled ? whiteboardUrl : undefined,
    whiteboardToken: aiEnabled ? token : undefined,
    userName: userNameRef.current || undefined,
    isHost: jwtDecoded.isHost,
    canSendAssistantMessage: canUseAssistant,
  });

  const wsUrl = useCallback(async () => {
    if (getWebSocketUri) {
      return getWebSocketUri();
    }

    const url = new URL("/connect", whiteboardUrl);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.hash = new URLSearchParams({ token: tokenRef.current }).toString();
    return url.toString();
  }, [getWebSocketUri, whiteboardUrl]);

  // Build asset store from uploadFile prop.
  const assetStore = useMemo<TLAssetStore | undefined>(() => {
    if (!uploadFile) return undefined;
    return {
      async upload(_asset, file, _abortSignal) {
        const result = await uploadFile(file);
        return { src: result.url };
      },
      resolve(asset, _ctx) {
        const src = asset.props.src ?? null;
        return src ? resolveAssetUrl?.(src) ?? src : null;
      },
      async remove(assetIds) {
        if (!deleteFile) return;
        const ed = editorRef.current;
        if (!ed) return;
        await Promise.allSettled(
          assetIds.map(async (assetId) => {
            const asset = ed.getAsset(assetId);
            const src = asset?.props.src;
            if (
              typeof src === "string" &&
              (src.startsWith("http://") || src.startsWith("https://") || src.startsWith("/api/wb-assets/"))
            ) {
              const stillReferenced = ed
                .getAssets()
                .some((otherAsset) => otherAsset.id !== assetId && otherAsset.props.src === src);
              if (stillReferenced) return;
              await deleteFile(src);
            }
          })
        );
      },
    };
  }, [uploadFile, deleteFile, resolveAssetUrl]);

  // Keep the screenshot tool's upload reference in sync (keyed by editor)
  useEffect(() => {
    if (!editor) return;
    setScreenshotUploadFile(editor, uploadFile ?? null);
    return () => setScreenshotUploadFile(editor, null);
  }, [editor, uploadFile]);

  // Handle server-sent custom messages (whiteboard state + page sync + AI broadcasts)
  const handleCustomMessage = useCallback((data: unknown) => {
    if (!data || typeof data !== "object") return;
    const msg = data as Record<string, unknown>;

    // Whiteboard capability state updates
    if (isWhiteboardStateEvent(msg.type)) {
      const editorUserIds = Array.isArray(msg.editorUserIds)
        ? msg.editorUserIds
        : Array.isArray(msg.writerUserIds)
          ? msg.writerUserIds
          : [];
      const userId = userIdRef.current;
      // Meeting hosts always have canvas edit access. Never let a state broadcast downgrade them.
      if (userId && !isHostRef.current) {
        const canEditCanvasNext = editorUserIds.includes(userId);
        setCanEditCanvas(canEditCanvasNext);
        if (canEditCanvasNext) {
          setEditAccessRequested(false);
        }
      }
      // Sync AI panel open state for late joiners / rejoiners
      if (msg.aiPanelOpen === true) {
        assistant.handleBroadcast({ type: WHITEBOARD_EVENTS.ASSISTANT_PANEL_OPEN });
      }
      setNavigationControllerUserId(
        ((msg.navigationControllerUserId ?? msg.presenterUserId) as string | null) ?? null
      );
      setNavigationControllerName(
        ((msg.navigationControllerName ?? msg.presenterName) as string | null) ?? null
      );
      setActingManagerId(((msg.actingManagerId ?? msg.promotedHostId) as string | null) ?? null);
      if (!hasAppliedInitialServerPageRef.current) {
        applyRemotePageSync(msg.pageNumber, { initial: true });
      }
      // Connected users list — only sent to managers for the hand-off UI
      if (Array.isArray(msg.connectedUsers)) {
        setConnectedUsers(msg.connectedUsers as { userId: string; userName: string }[]);
      }
    }

    if (isCanvasAccessGrantedEvent(msg.type)) {
      setCanEditCanvas(true);
      setEditAccessRequested(false);
    }

    if (isCanvasAccessDeniedEvent(msg.type) || isCanvasAccessRevokedEvent(msg.type)) {
      setCanEditCanvas(false);
      setEditAccessRequested(false);
    }

    // Page sync from the navigation controller — navigate to the specified page.
    // Mark it as remote-triggered so controllers don't re-broadcast this change.
    if (isPageSyncEvent(msg.type) && typeof msg.pageNumber === "number") {
      applyRemotePageSync(msg.pageNumber);
    }

    // AI assistant broadcasts
    if (typeof msg.type === "string" && msg.type.startsWith("assistant.")) {
      assistant.handleBroadcast(data);
    }

    // Forward all custom messages to parent
    onCustomMessage?.(data);
  }, [applyRemotePageSync, assistant.handleBroadcast, onCustomMessage]);

  const sync = useWhiteboardSync({
    uri: wsUrl,
    assets: assetStore,
    shapeUtils: whiteboardSyncShapeUtils,
    users,
    onCustomMessageReceived: handleCustomMessage,
  });

  const syncReady = sync.status === "synced-remote";
  const isLoading = sync.status === "loading";
  const isError = sync.status === "error";
  const syncConnectionStatus = sync.status === "synced-remote" ? sync.connectionStatus : "offline";
  const shouldRenderAssistantPanel =
    !!aiEnabled &&
    !!aiApiUrl &&
    (assistant.showPanel ||
      assistant.messages.length > 0 ||
      assistant.isStreaming ||
      !!assistant.error);

  useEffect(() => {
    if (!syncReady || syncConnectionStatus !== "online") {
      hasAppliedInitialServerPageRef.current = false;
    }
  }, [syncConnectionStatus, syncReady]);

  useEffect(() => {
    if (!onStatusChange) return;
    if (isError) {
      onStatusChange("error");
      return;
    }
    if (syncReady) {
      onStatusChange("ready");
      return;
    }
    onStatusChange("loading");
  }, [isError, onStatusChange, syncReady]);

  useEffect(() => {
    if (!onConnectionStatusChange) return;
    onConnectionStatusChange(syncConnectionStatus === "online" ? "online" : "offline");
  }, [onConnectionStatusChange, syncConnectionStatus]);

  useEffect(() => {
    if (!editor || !onContentStateChange) return;

    const notifyContentState = () => {
      const hasContent = editor.getCurrentPageShapes().some((shape) => shape.type !== "frame");
      onContentStateChange(hasContent);
    };

    notifyContentState();
    const unsubscribe = editor.store.listen(notifyContentState, { scope: "document" });

    return () => {
      unsubscribe();
      onContentStateChange(false);
    };
  }, [editor, onContentStateChange]);

  // Request canvas edit access
  const requestEditAccess = useCallback(async () => {
    if (editAccessRequested || !onRequestEditAccess) return;

    setEditAccessRequested(true);
    try {
      const result = await onRequestEditAccess();
      if (!mountedRef.current) return; // guard against unmount
      // If already approved (e.g. rejoining after disconnect), the server
      // will re-trigger an access grant + session reconnect, so we just
      // need to clear the waiting state.
      if (result && result.status === "already_approved") {
        setEditAccessRequested(false);
      }
      // Server will grant access and force reconnect with canvas edit access.
    } catch (err) {
      if (!mountedRef.current) return; // guard against unmount
      console.error("Failed to request whiteboard edit access:", err);
      setEditAccessRequested(false);
    }
  }, [editAccessRequested, onRequestEditAccess]);

  // Approve write request
  const grantEditAccess = useCallback(async (targetUserId: string) => {
    if (!onGrantEditAccess) return;
    try {
      await onGrantEditAccess(targetUserId);
    } catch (err) {
      console.error("Failed to grant whiteboard edit access:", err);
    }
  }, [onGrantEditAccess]);

  // Deny write request
  const denyEditAccess = useCallback(async (targetUserId: string) => {
    if (!onDenyEditAccessRequest) return;
    try {
      await onDenyEditAccessRequest(targetUserId);
    } catch (err) {
      console.error("Failed to deny whiteboard edit access:", err);
    }
  }, [onDenyEditAccessRequest]);

  // Page management
  const wb = useWhiteboardPages({
    editor,
    syncReady,
    canEditCanvas,
  });

  pageCountRef.current = wb.pages.length;

  useEffect(() => {
    onCurrentPageChange?.(wb.currentPage);
  }, [onCurrentPageChange, wb.currentPage]);

  // Keep changePageRef in sync so handleCustomMessage can call it
  useEffect(() => {
    changePageRef.current = wb.changePage;
    changePageReadyRef.current = true;
  }, [wb.changePage]);

  useEffect(() => {
    const pendingPage = pendingRemotePageRef.current;
    if (!syncReady || !pendingPage || pendingPage > wb.pages.length) return;
    pendingRemotePageRef.current = null;
    remotePageSyncRef.current = pendingPage;
    wb.changePage(pendingPage);
  }, [syncReady, wb.pages.length, wb.changePage]);

  usePageImagePreloader(editor, wb.pages, wb.currentPage, resolveAssetUrl);

  // Responsive behavior
  const { isMobileLandscape } = useWhiteboardResponsive({
    editor,
    pageManagerRef: wb.pageManagerRef,
    cameraConstraintsRef: wb.cameraConstraintsRef,
  });

  // Editor instance setup
  useEffect(() => {
    if (!editor) return;

    const isCoarsePointer =
      typeof window !== "undefined"
        ? window.matchMedia("(pointer: coarse)").matches
        : false;

    editor.updateInstanceState({
      isDebugMode: false,
      isChatting: false,
      isCoarsePointer,
      isPenMode: false,
    });
  }, [editor]);

  // Protect page frames
  useEffect(() => {
    if (!editor) return;
    return registerPageFrameProtection(editor);
  }, [editor]);

  // Normalize math/logic symbols in text shapes (-> → →, <= → ≤, etc.)
  useEffect(() => {
    if (!editor) return;
    return registerTextNormalization(editor);
  }, [editor]);

  // Register URL unfurling handler for bookmark shapes
  useEffect(() => {
    if (!editor || !whiteboardUrl) return;

    editor.registerExternalAssetHandler("url", async ({ url }) => {
      let title = "";
      let description = "";
      let image = "";
      let favicon = "";

      try {
        const resp = await fetch(`${whiteboardUrl}/unfurl`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ url }),
        });
        if (resp.ok) {
          const data = await resp.json();
          if (data && typeof data === "object") {
            const record = data as Record<string, unknown>;
            title = typeof record.title === "string" ? record.title : "";
            description = typeof record.description === "string" ? record.description : "";
            image = typeof record.image === "string" ? record.image : "";
            favicon = typeof record.favicon === "string" ? record.favicon : "";
          }
        }
      } catch {
        // fallback to hostname
      }

      if (!title) {
        try { title = new URL(url).hostname; } catch { title = url; }
      }

      return {
        id: AssetRecordType.createId(getHashForString(url)),
        typeName: "asset" as const,
        type: "bookmark" as const,
        props: {
          src: url,
          title,
          description,
          image,
          favicon,
        },
        meta: {},
      };
    });
  }, [editor, whiteboardUrl, token]);

  // Preload dynamic imports so they're warm when the user first pastes/drops
  useEffect(() => {
    import("../lib/import-image").catch(() => {});
    import("../lib/export-png").catch(() => {});
  }, []);

  // Set default tool
  useEffect(() => {
    if (!editor) return;
    if (canEditCanvas) {
      editor.setCurrentTool("draw");
    } else {
      editor.setCurrentTool("hand");
    }
  }, [editor, canEditCanvas]);

  // Auto-parent shapes to frames
  useEffect(() => {
    if (!editor) return;

    const cleanup = registerShapeParentingSideEffect(
      editor,
      () => wb.pageManagerRef.current
    );

    if (syncReady) {
      reparentOrphanedShapes(editor, () => wb.pageManagerRef.current);

      // Migrate old page frames:
      //   1. Frames with meta.isPageFrame that are still locked → unlock.
      //   2. Frames with "Page N" name but no meta.isPageFrame (pre-meta era) → tag + unlock.
      const framesToMigrate = editor
        .getCurrentPageShapes()
        .filter((s) => {
          if (s.type !== "frame") return false;
          const meta = s.meta as Record<string, unknown> | undefined;
          const isTagged = meta?.isPageFrame === true;
          const hasPageName = (s.props as { name?: string }).name?.startsWith("Page ");
          return (isTagged && s.isLocked) || (!isTagged && !!hasPageName);
        });
      if (framesToMigrate.length > 0) {
        editor.updateShapes(
          framesToMigrate.map((s) => ({
            id: s.id,
            type: "frame" as const,
            isLocked: false,
            meta: { ...(s.meta as Record<string, unknown>), isPageFrame: true },
          }))
        );
      }
    }

    return cleanup;
  }, [editor, syncReady, wb.pageManagerRef]);

  const exportSnapshot = useCallback(async () => {
    if (!editor) throw new Error("Whiteboard editor unavailable");
    const pm = wb.pageManagerRef.current;
    if (!pm) throw new Error("Whiteboard page manager unavailable");
    const currentPages = pm.getPages();
    if (currentPages.length === 0) {
      throw new Error("No whiteboard pages to export");
    }

    const { exportWhiteboardToPng } = await import("../lib/export-png");
    return exportWhiteboardToPng(
      editor,
      currentPages.map((page) => page.id)
    );
  }, [editor, wb.pageManagerRef]);

  useEffect(() => {
    if (!onSnapshotReady) return;
    onSnapshotReady(editor ? exportSnapshot : null);
    return () => onSnapshotReady(null);
  }, [editor, exportSnapshot, onSnapshotReady]);

  // Only the whiteboard manager or designated navigation controller drives page navigation for everyone.
  // Canvas editors who are not controlling navigation move locally without affecting others.
  const {
    isNavigationController,
    canManageNavigationController,
    shouldSyncPages,
  } = useMemo(
    () =>
      deriveNavigationState({
        myUserId: jwtDecoded.userId,
        canManageNavigation: isHost,
        actingManagerId,
        navigationControllerUserId,
      }),
    [isHost, jwtDecoded.userId, actingManagerId, navigationControllerUserId]
  );

  // Stable refs so the navigation-controller-gained effect doesn't need them as deps.
  const onPageSyncRef = useRef(onPageSync);
  onPageSyncRef.current = onPageSync;

  const prevSyncedPageRef = useRef<number | null>(null);

  // When a participant gains navigation control mid-session, immediately sync
  // everyone to their current page so the class jumps to them rather than waiting
  // for them to navigate first.
  const prevIsNavigationControllerRef = useRef(false);
  useEffect(() => {
    const justGainedNavigationControl = isNavigationController && !prevIsNavigationControllerRef.current;
    prevIsNavigationControllerRef.current = isNavigationController;

    if (!justGainedNavigationControl || !syncReady) return;

    const currentPage = wb.currentPageRef.current;
    remotePageSyncRef.current = null;
    prevSyncedPageRef.current = currentPage;
    onPageSyncRef.current?.(currentPage)?.catch(() => {});
  }, [isNavigationController, syncReady]);

  // Sync page changes to all participants.
  // When a navigation controller is active, only they drive navigation.
  // Otherwise, the whiteboard manager drives it.
  useEffect(() => {
    if (!shouldSyncPages || !syncReady || !onPageSync) return;
    // Don't sync on initial mount — only react to actual navigation.
    if (prevSyncedPageRef.current === null) {
      if (remotePageSyncRef.current === wb.currentPage) {
        remotePageSyncRef.current = null;
      }
      prevSyncedPageRef.current = wb.currentPage;
      return;
    }
    if (prevSyncedPageRef.current === wb.currentPage) return;
    // Page change was triggered by receiving a remote page.sync broadcast —
    // don't re-broadcast it.
    if (remotePageSyncRef.current === wb.currentPage) {
      prevSyncedPageRef.current = wb.currentPage;
      remotePageSyncRef.current = null;
      return;
    }
    prevSyncedPageRef.current = wb.currentPage;
    onPageSync(wb.currentPage).catch(() => {});
  }, [shouldSyncPages, syncReady, wb.currentPage, onPageSync]);

  // Toolbar "+" always inserts after the current page so you can add a page
  // in the middle of the deck. Pull-to-create and the viewport next-page
  // button still call wb.addPage (append at end).
  const insertPageAfterCurrentAndSync = useCallback(() => {
    wb.insertPageAfterCurrent();
  }, [wb.insertPageAfterCurrent]);

  const toolbarContextValue = useMemo(
    () => ({
      pageManager: wb.pageManagerRef.current,
      onPagesChanged: wb.onPagesChanged,
      currentPage: wb.currentPage,
      pages: wb.pages,
      onAddPage: insertPageAfterCurrentAndSync,
      onInsertPageAfter: canEditCanvas ? wb.insertPageAfter : undefined,
      onClearPage: wb.clearPage,
      onPageChange: wb.changePage,
      canEditCanvas,
      uploadFile,
      isPhone,
      aiEnabled: !!aiEnabled && !!aiApiUrl,
      isAiPanelOpen: assistant.showPanel,
      onToggleAi: () => {
        if (assistant.showPanel) {
          assistant.closePanel();
        } else {
          assistant.openPanel();
        }
      },
      isLoading,
      isConnected: syncReady,
      whiteboardUrl,
      whiteboardToken: token,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      wb.onPagesChanged,
      wb.pages,
      wb.currentPage,
      canEditCanvas,
      insertPageAfterCurrentAndSync,
      wb.insertPageAfter,
      wb.clearPage,
      wb.changePage,
      wb.pageManagerVersion,
      uploadFile,
      isPhone,
      isLoading,
      syncReady,
      assistant.showPanel,
      assistant.closePanel,
      assistant.openPanel,
      whiteboardUrl,
      token,
    ]
  );

  const components = useMemo(
    () => ({
      Toolbar: null,
      InFrontOfTheCanvas: () => (
        <>
          <WhiteboardBoundsStabilizer />
          <WhiteboardPenModeBridge />
          {canEditCanvas && <WhiteboardToolbar />}
          {canEditCanvas && <WhiteboardCanvasOverlays />}
        </>
      ),
      OnTheCanvas: () => (
        <PageShadows canEditCanvas={canEditCanvas} onAddPage={canEditCanvas ? wb.addPage : undefined} />
      ),
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
    [canEditCanvas, wb.addPage]
  );

  // Keep the last valid store during reconnection
  // mutation moved to useEffect to avoid side effects during render
  const tldrawStoreRaw =
    sync.status === "synced-remote" ? sync.store : null;
  const lastValidStoreRef = useRef(tldrawStoreRaw);
  useEffect(() => {
    if (tldrawStoreRaw) {
      lastValidStoreRef.current = tldrawStoreRaw;
    }
  }, [tldrawStoreRaw]);
  const tldrawStore = tldrawStoreRaw ?? lastValidStoreRef.current ?? undefined;

  const importImageFilesToCurrentPage = useCallback(
    async (files: File[]) => {
      if (!canEditCanvas || !editor || !uploadFile) return false;

      const pageManager = wb.pageManagerRef.current;
      if (!pageManager) return false;

      const { supported: imageFiles, unsupportedImages } = filterSupportedImageFiles(files);
      if (imageFiles.length === 0) {
        if (unsupportedImages.length > 0) {
          throw new Error("Supported image formats: PNG, JPEG, GIF, WEBP");
        }
        return false;
      }

      const { importImageToWhiteboard } = await import("../lib/import-image");
      const pageNumber = wb.currentPageRef.current;
      for (const imageFile of imageFiles) {
        await importImageToWhiteboard(
          editor,
          imageFile,
          pageManager,
          pageNumber
        );
      }

      wb.onPagesChanged();
      return true;
    },
    [
      canEditCanvas,
      editor,
      uploadFile,
      wb.pageManagerRef,
      wb.currentPageRef,
      wb.onPagesChanged,
    ]
  );

  const emitImportError = useCallback((message: string) => {
    if (typeof window === "undefined") return;
    window.dispatchEvent(
      new CustomEvent(WHITEBOARD_IMPORT_ERROR_EVENT, {
        detail: { message },
      })
    );
  }, []);

  const importExternalImageUrl = useCallback(
    async (url: string) => {
      if (!canEditCanvas) {
        throw new Error("Write access is required to add images");
      }
      if (!editor || !uploadFile) {
        throw new Error("Whiteboard image uploads are unavailable");
      }

      const pageManager = wb.pageManagerRef.current;
      if (!pageManager) {
        throw new Error("Whiteboard page manager unavailable");
      }

      const { fetchExternalImage, importImageToWhiteboard, looksLikeImageUrl } =
        await import("../lib/import-image");

      if (!looksLikeImageUrl(url)) {
        throw new Error("URL does not point to an image");
      }

      const imageFile = fetchExternalImageFile
        ? await fetchExternalImageFile(url)
        : await fetchExternalImage(url);
      await importImageToWhiteboard(
        editor,
        imageFile,
        pageManager,
        wb.currentPageRef.current
      );

      wb.onPagesChanged();
    },
    [
      canEditCanvas,
      editor,
      fetchExternalImageFile,
      uploadFile,
      wb.pageManagerRef,
      wb.currentPageRef,
      wb.onPagesChanged,
    ]
  );

  useImperativeHandle(
    ref,
    () => ({
      importExternalImage: importExternalImageUrl,
    }),
    [importExternalImageUrl]
  );

  const handleBeforePasteFromClipboard = useCallback(
    async ({ content }: ClipboardPasteInfo) => {
      if (content.type !== "files" || !content.files?.length) return;

      try {
        const imported = await importImageFilesToCurrentPage(content.files);
        if (imported) {
          return false;
        }
      } catch (err) {
        console.error("[WB] Failed to import pasted image:", err);
        emitImportError(
          err instanceof Error ? err.message : "Could not import pasted image"
        );
        return false;
      }
    },
    [emitImportError, importImageFilesToCurrentPage]
  );

  const beforePasteHandlerRef = useRef(handleBeforePasteFromClipboard);
  beforePasteHandlerRef.current = handleBeforePasteFromClipboard;

  const tldrawOptions = useMemo(
    () =>
      ({
        onBeforePasteFromClipboard: (info: BeforePasteInfo) =>
          beforePasteHandlerRef.current(info as ClipboardPasteInfo),
        text: {
          tipTapConfig: {
            extensions: whiteboardTipTapExtensions,
          },
        },
      }) satisfies Partial<TldrawOptions>,
    []
  );

  // Visual-only drag overlay (pointer-events-none — tldraw owns the actual drop event)
  const [isDraggingOver, setIsDraggingOver] = useState(false);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    const dragTypes = Array.from(e.dataTransfer.types);
    const hasImagePayload =
      dragTypes.includes("Files") ||
      dragTypes.includes("application/x-ossmeet-image-url") ||
      dragTypes.includes("text/uri-list");

    if (!hasImagePayload) return;
    e.preventDefault();
    setIsDraggingOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    if (e.currentTarget === e.target) {
      setIsDraggingOver(false);
    }
  }, []);

  const handleDragEnd = useCallback(() => {
    setIsDraggingOver(false);
  }, []);

  // Register tldraw's 'files' content handler so file drops (Finder, browser, etc.)
  // go through our importImageToWhiteboard pipeline (centered on current page).
  // This replaces tldraw's default file-drop handler and is the correct integration point.
  useEffect(() => {
    if (!editor) return;
    if (!uploadFile) {
      editor.registerExternalContentHandler("files", null);
      return;
    }

    // re-registering the same content type replaces the previous handler in tldraw
    editor.registerExternalContentHandler("files", async ({ files }) => {
      if (!canEditCanvas) return;
      const pageManager = wb.pageManagerRef.current;
      if (!pageManager) return;

      setIsDraggingOver(false);

      const { supported: imageFiles, unsupportedImages } = filterSupportedImageFiles(files);
      if (imageFiles.length === 0) {
        if (unsupportedImages.length > 0) {
          emitImportError("Supported image formats: PNG, JPEG, GIF, WEBP");
        }
        return;
      }

      try {
        const { importImageToWhiteboard } = await import("../lib/import-image");
        const pageNumber = wb.currentPageRef.current;
        for (const imageFile of imageFiles) {
          await importImageToWhiteboard(
            editor,
            imageFile,
            pageManager,
            pageNumber
          );
        }
        wb.onPagesChanged();
      } catch (err) {
        console.error("[WB] Failed to import dropped image:", err);
        emitImportError(
          err instanceof Error ? err.message : "Could not import dropped image"
        );
      }
    });
    return () => {
      editor.registerExternalContentHandler("files", null);
    };
  }, [
    editor,
    canEditCanvas,
    emitImportError,
    uploadFile,
    wb.pageManagerRef,
    wb.currentPageRef,
    wb.onPagesChanged,
  ]);

  useEffect(() => {
    if (!editor) return;

    // re-registering the same content type replaces the previous handler in tldraw
    editor.registerExternalContentHandler("url", async (externalContent) => {
      if (!canEditCanvas || !uploadFile) return;

      const { looksLikeImageUrl } = await import("../lib/import-image");
      if (!looksLikeImageUrl(externalContent.url)) {
        return defaultHandleExternalUrlContent(
          editor,
          externalContent,
          defaultUrlHandlerOpts
        );
      }

      try {
        setIsDraggingOver(false);
        await importExternalImageUrl(externalContent.url);
      } catch (err) {
        console.error("[WB] Failed to import dropped image URL:", err);
        emitImportError(
          err instanceof Error ? err.message : "Could not import dropped image"
        );
        return defaultHandleExternalUrlContent(
          editor,
          externalContent,
          defaultUrlHandlerOpts
        );
      }
    });
    return () => {
      editor.registerExternalContentHandler("url", null);
    };
  }, [
    editor,
    canEditCanvas,
    uploadFile,
    emitImportError,
    importExternalImageUrl,
    defaultUrlHandlerOpts,
  ]);

  if (isError) {
    return (
      <div className="flex h-full items-center justify-center bg-white text-sm text-red-600">
        Failed to connect to whiteboard.
      </div>
    );
  }

  if (!tldrawStore && isLoading) {
    return (
      <div className="relative h-full w-full overflow-hidden bg-white">
        <div className="relative flex h-full items-center justify-center px-6">
          <div className="flex items-center gap-3 rounded-2xl border border-stone-300/70 bg-white/80 px-5 py-3 text-sm text-stone-700 shadow-lg backdrop-blur-sm">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-stone-400 border-t-transparent" />
            <span>Preparing whiteboard...</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="whiteboard-document relative h-full w-full"
      style={{ background: "#ffffff", "--wb-document-bg": "#ffffff" } as React.CSSProperties}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDragEnd={handleDragEnd}
    >
      {/* Visual-only drag overlay — pointer-events-none so tldraw's canvas receives the drop */}
      {isDraggingOver && canEditCanvas && (
        <div className="absolute inset-0 z-[1000] flex items-center justify-center bg-primary-500/20 backdrop-blur-sm pointer-events-none">
          <div className="bg-white rounded-2xl shadow-2xl px-8 py-6 border-2 border-primary-500 border-dashed">
            <p className="text-lg font-semibold text-stone-900">Drop image here</p>
            <p className="text-sm text-stone-600 mt-1">Drop an image file or an image URL</p>
          </div>
        </div>
      )}

      {/* Edit access request button for viewers */}
      {syncReady && !canEditCanvas && !isHost && !editAccessRequested && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-20 pointer-events-auto">
          <button
            type="button"
            onClick={requestEditAccess}
            className="px-4 py-2 text-sm font-medium rounded-lg bg-primary-600 text-white hover:bg-primary-500 transition-colors shadow-lg"
          >
            Request Edit Access
          </button>
        </div>
      )}

      {/* Waiting for approval message */}
      {syncReady && !canEditCanvas && !isHost && editAccessRequested && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-20 pointer-events-auto">
          <div className="px-4 py-2 text-sm font-medium rounded-lg bg-stone-700 text-white shadow-lg">
            Waiting for edit access approval...
          </div>
        </div>
      )}

      {/* Pending requests panel for managers */}
      {showManagerRequestPanel &&
        syncReady &&
        canManageNavigationController &&
        pendingEditorRequests.length > 0 && (
          <div className="fixed right-4 top-20 z-20 max-w-sm rounded-lg bg-white p-4 shadow-xl pointer-events-auto">
            <h3 className="mb-3 text-sm font-semibold text-stone-900">
              Edit Access Requests
            </h3>
            <div className="space-y-2">
              {pendingEditorRequests.map((request) => (
                <div
                  key={request.userId}
                  className="flex items-center justify-between gap-3 rounded bg-stone-50 p-2"
                >
                  <span className="truncate text-sm text-stone-700">
                    {request.userName}
                  </span>
                  <div className="flex shrink-0 gap-2">
                    <button
                      type="button"
                      onClick={() => grantEditAccess(request.userId)}
                      className="rounded bg-green-700 px-3 py-1 text-xs font-medium text-white transition-colors hover:bg-green-600"
                    >
                      Approve
                    </button>
                    <button
                      type="button"
                      onClick={() => denyEditAccess(request.userId)}
                      className="rounded bg-red-600 px-3 py-1 text-xs font-medium text-white transition-colors hover:bg-red-500"
                    >
                      Deny
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

      {/* Tldraw Canvas */}
      <div className="absolute inset-0 z-0">
        <WhiteboardToolbarContext.Provider value={toolbarContextValue}>
          <Tldraw
            store={tldrawStore}
            onMount={setEditor}
            hideUi
            components={components}
            tools={whiteboardTools}
            shapeUtils={whiteboardShapeUtils}
            users={users}
            assetUrls={assetUrls as any}
            options={tldrawOptions}
            overlayUtils={[GlowLaserOverlayUtil, GlowCollaboratorLaserOverlayUtil]}
            licenseKey={import.meta.env.VITE_TLDRAW_LICENSE_KEY || undefined}
          />
        </WhiteboardToolbarContext.Provider>
      </div>

      {/* AI Assistant Panel */}
      {shouldRenderAssistantPanel && (
        <Suspense fallback={null}>
          <LazyWhiteboardAssistant
            editor={editor}
            open={assistant.showPanel}
            onClose={canEditCanvas ? assistant.closePanel : assistant.localClosePanel}
            messages={assistant.messages}
            isStreaming={assistant.isStreaming}
            error={assistant.error}
            sendQuestion={assistant.sendQuestion}
            cancel={assistant.cancel}
            clearMessages={assistant.clearMessages}
            canSendAssistantMessage={canUseAssistant}
            canClearMessages={jwtDecoded.isHost || userIdRef.current === actingManagerId}
            isPhone={isPhone}
          />
        </Suspense>
      )}

      <WhiteboardViewportControls
        canEditCanvas={canEditCanvas}
        isMobileLandscape={isMobileLandscape}
        pages={wb.pages}
        currentPage={wb.currentPage}
        zoomPercent={wb.zoomPercent}
        onPageChange={wb.changePage}
        onAddPage={canEditCanvas ? wb.addPage : undefined}
        onInsertPageAfter={canEditCanvas ? wb.insertPageAfter : undefined}
        onZoomIn={wb.zoomIn}
        onZoomOut={wb.zoomOut}
        onZoomToPage={wb.zoomToPage}
        canManageNavigation={canManageNavigationController}
        isNavigationController={isNavigationController}
        myUserId={jwtDecoded.userId}
        navigationControllerName={navigationControllerName}
        connectedUsers={connectedUsers}
        onSetNavigationController={onSetNavigationController}
        onReleaseNavigationController={onReleaseNavigationController}
      />

      {/* Clear page confirmation dialog */}
      {wb.showClearPageDialog && (
        <div className="absolute inset-0 z-[500] flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl p-6 max-w-sm mx-4">
            <h3 className="text-lg font-semibold text-stone-900">
              Clear page {wb.currentPage}?
            </h3>
            <p className="mt-2 text-sm text-stone-500">
              This will remove all drawings on this page and cannot be
              undone for other participants.
            </p>
            <div className="flex gap-2 justify-end mt-4">
              <button
                type="button"
                onClick={() => wb.setShowClearPageDialog(false)}
                className="px-4 py-2 text-sm font-medium rounded-lg border border-stone-300 text-stone-700 hover:bg-stone-50 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  wb.handleClearPageConfirmed();
                  wb.setShowClearPageDialog(false);
                }}
                className="px-4 py-2 text-sm font-medium rounded-lg bg-red-600 text-white hover:bg-red-700 transition-colors"
              >
                Clear
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
});
