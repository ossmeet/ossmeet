import { useCallback, useEffect, useRef, useState } from "react";
import { useEditor } from "tldraw";
import { WHITEBOARD_CONFIG } from "../lib/constants";
import {
  parsePageBackground,
  type PageBackground,
} from "../lib/page-background";
import {
  getPullToAddProgress,
  AUTO_ADD_PAGE_PULL_DISTANCE,
  PULL_TO_ADD_INDICATOR_MIN_PROGRESS,
  isPullToAddReady,
  isNearFitWidthZoom,
} from "../lib/pull-to-add";
import { usePullToAddPage } from "../lib/use-pull-to-add-page";
import { ArrowDown, FilePlus } from "lucide-react";

const { PAGE_WIDTH, PAGE_HEIGHT } = WHITEBOARD_CONFIG;

interface FrameRect {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  background: PageBackground;
  name: string;
}

interface ViewportState {
  bottom: number;
  zoom: number;
  nearFitZoom: boolean;
}

interface PageShadowsProps {
  canEditCanvas: boolean;
  onAddPage?: () => void;
}

interface PullToAddPageIndicatorProps {
  top: number;
  left: number;
  progress: number;
  ready: boolean;
}

function areFramesEqual(a: FrameRect[], b: FrameRect[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;

  for (let i = 0; i < a.length; i += 1) {
    const left = a[i];
    const right = b[i];
    if (
      left.id !== right.id ||
      left.x !== right.x ||
      left.y !== right.y ||
      left.w !== right.w ||
      left.h !== right.h ||
      left.name !== right.name ||
      left.background !== right.background
    ) {
      return false;
    }
  }

  return true;
}

function areViewportStatesEqual(a: ViewportState, b: ViewportState): boolean {
  return (
    Math.abs(a.bottom - b.bottom) < 0.5 &&
    a.zoom === b.zoom &&
    a.nearFitZoom === b.nearFitZoom
  );
}

function PullToAddPageIndicator({
  top,
  left,
  progress,
  ready,
}: PullToAddPageIndicatorProps) {
  return (
    <div
      style={{
        position: "absolute",
        top,
        left,
        transform: `translate(-50%, -50%) scale(${0.8 + progress * 0.2})`,
        opacity: Math.max(0.3, progress),
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "12px",
        color: ready ? "#3b82f6" : "#9ca3af",
        transition: "color 0.2s ease",
        pointerEvents: "none",
        zIndex: 10,
      }}
    >
      <div
        style={{
          width: "64px",
          height: "64px",
          borderRadius: "50%",
          border: `3px solid ${ready ? "#3b82f6" : "#d1d5db"}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "white",
          boxShadow: ready
            ? "0 4px 12px rgba(59, 130, 246, 0.2)"
            : "0 2px 8px rgba(0,0,0,0.05)",
          transition: "all 0.2s ease",
        }}
      >
        {ready ? (
          <FilePlus size={28} />
        ) : (
          <ArrowDown
            size={28}
            style={{
              transform: `translateY(${progress * 5}px)`,
              transition: "transform 0.1s linear",
            }}
          />
        )}
      </div>
      <span
        style={{
          fontFamily: "Inter, sans-serif",
          fontWeight: 500,
          fontSize: "14px",
          letterSpacing: "0.5px",
          whiteSpace: "nowrap",
        }}
      >
        {ready ? "Release to Add Page" : "Pull to Add Page"}
      </span>
    </div>
  );
}

/**
 * Tracks page frames in page-space coordinates for overlays that need to align
 * with the document. The actual page paper is rendered by CustomFrameShapeUtil
 * so it shares the same layer and lifecycle as the frame shape.
 */
export function PageShadows({ canEditCanvas, onAddPage }: PageShadowsProps) {
  const editor = useEditor();
  const [frames, setFrames] = useState<FrameRect[]>([]);
  const [viewportState, setViewportState] = useState<ViewportState>({
    bottom: 0,
    zoom: 1,
    nearFitZoom: true,
  });
  const rafRef = useRef(0);
  const cameraRafRef = useRef(0);

  const updateFrames = useCallback(() => {
    const shapes = editor.getCurrentPageShapes();
    const pageFrames: FrameRect[] = [];

    for (const shape of shapes) {
      if (shape.type !== "frame") continue;
      if ((shape.meta as Record<string, unknown> | undefined)?.isPageFrame !== true)
        continue;

      pageFrames.push({
        id: shape.id,
        x: shape.x,
        y: shape.y,
        w: (shape.props as { w: number }).w ?? PAGE_WIDTH,
        h: (shape.props as { h: number }).h ?? PAGE_HEIGHT,
        background: parsePageBackground(shape.meta?.background),
        name: (shape.props as { name?: string }).name ?? "",
      });
    }

    pageFrames.sort((a, b) => a.y - b.y);
    setFrames((prev) => (areFramesEqual(prev, pageFrames) ? prev : pageFrames));
  }, [editor]);

  useEffect(() => {
    updateFrames();

    const updateCamera = () => {
      const viewportBounds = editor.getViewportPageBounds();
      // getEfficientZoomLevel() returns a stepped value that avoids unnecessary
      // re-renders during continuous zoom (recommended by tldraw performance docs).
      const zoom = editor.getEfficientZoomLevel();
      const fitWidthZoom = editor.getViewportScreenBounds().width / PAGE_WIDTH;
      const nextState = {
        bottom: viewportBounds.y + viewportBounds.h,
        zoom,
        nearFitZoom: isNearFitWidthZoom(zoom, fitWidthZoom),
      };
      setViewportState((prev) =>
        areViewportStatesEqual(prev, nextState) ? prev : nextState
      );
    };
    updateCamera();

    const scheduleCameraUpdate = () => {
      cancelAnimationFrame(cameraRafRef.current);
      cameraRafRef.current = requestAnimationFrame(updateCamera);
    };

    const unsubStore = editor.store.listen(
      () => {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = requestAnimationFrame(updateFrames);
      },
      { scope: "document" }
    );

    const unsubCamera = editor.store.listen(scheduleCameraUpdate, {
      scope: "session",
    });

    return () => {
      unsubStore();
      unsubCamera();
      cancelAnimationFrame(rafRef.current);
      cancelAnimationFrame(cameraRafRef.current);
    };
  }, [editor, updateFrames]);

  const lastFrame = frames.length > 0 ? frames[frames.length - 1] : null;

  let pullProgress = 0;
  let indicatorTop = 0;
  let pullReady = false;
  if (lastFrame) {
    const lastPageBottom = lastFrame.y + lastFrame.h;
    const zoom = Math.max(viewportState.zoom, 0.01);
    const minOffset = 24 / zoom;
    const trailingGap = 56 / zoom;

    pullProgress = getPullToAddProgress(lastPageBottom, viewportState.bottom);
    pullReady = isPullToAddReady(lastPageBottom, viewportState.bottom);
    indicatorTop = Math.min(
      lastPageBottom + AUTO_ADD_PAGE_PULL_DISTANCE - minOffset,
      Math.max(
        lastPageBottom + minOffset,
        viewportState.bottom - trailingGap
      )
    );
  }

  usePullToAddPage({
    enabled: canEditCanvas && viewportState.nearFitZoom,
    ready: pullReady,
    onAddPage,
  });

  return (
    <>
      {/* Pull to Add Page Indicator */}
      {canEditCanvas &&
        lastFrame &&
        viewportState.nearFitZoom &&
        pullProgress >= PULL_TO_ADD_INDICATOR_MIN_PROGRESS && (
          <PullToAddPageIndicator
            top={indicatorTop}
            left={lastFrame.x + lastFrame.w / 2}
            progress={pullProgress}
            ready={pullReady}
          />
      )}
    </>
  );
}
