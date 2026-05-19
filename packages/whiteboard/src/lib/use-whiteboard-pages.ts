import { useCallback, useEffect, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { Editor, TLShapeId } from "tldraw";
import { CameraConstraints, type CameraDimensions } from "./camera-constraints";
import { PageManager, type WhiteboardPage, type PageDimensions } from "./page-manager";
import { getResponsiveConfig } from "./responsive-config";

// How long to suppress pull-to-add after a programmatic page add/insert.
// Needs to outlast WhiteboardBoundsStabilizer's burst (last fire at 32*16=512ms).
const SKIP_SNAP_AFTER_ADD_MS = 500;
const SKIP_SNAP_AFTER_INIT_MS = 700;

export interface UseWhiteboardPagesOptions {
  editor: Editor | null;
  syncReady: boolean;
  canEditCanvas: boolean;
}

export interface UseWhiteboardPagesReturn {
  pages: WhiteboardPage[];
  currentPage: number;
  pageManagerRef: React.RefObject<PageManager | null>;
  cameraConstraintsRef: React.RefObject<CameraConstraints | null>;
  currentPageRef: React.RefObject<number>;
  skipSnapRef: React.RefObject<number>;
  addPage: () => void;
  /** Insert a new blank page immediately after the current page and navigate to it. */
  insertPageAfterCurrent: () => void;
  /** Insert a new blank page immediately after the given page number and navigate to it. */
  insertPageAfter: (afterPageNumber: number) => void;
  changePage: (pageNumber: number) => void;
  onPagesChanged: () => void;
  clearPage: (() => void) | undefined;
  pendingClearShapeIds: React.RefObject<TLShapeId[]>;
  showClearPageDialog: boolean;
  setShowClearPageDialog: (show: boolean) => void;
  handleClearPageConfirmed: () => void;
  zoomPercent: number;
  zoomIn: () => void;
  zoomOut: () => void;
  zoomToPage: () => void;
  syncCameraConstraints: (pageNumber: number, pageList?: WhiteboardPage[]) => void;
  fitToPage: (pageNumber: number, animated?: boolean, pageList?: WhiteboardPage[]) => void;
  pageManagerVersion: number;
}

function arePagesEqual(a: WhiteboardPage[], b: WhiteboardPage[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;

  for (let i = 0; i < a.length; i += 1) {
    const left = a[i];
    const right = b[i];
    if (
      left.id !== right.id ||
      left.number !== right.number ||
      left.y !== right.y ||
      left.height !== right.height
    ) {
      return false;
    }
  }

  return true;
}

function setPagesIfChanged(
  setPages: Dispatch<SetStateAction<WhiteboardPage[]>>,
  nextPages: WhiteboardPage[]
): void {
  setPages((prev) => (arePagesEqual(prev, nextPages) ? prev : nextPages));
}

export function useWhiteboardPages({
  editor,
  syncReady,
  canEditCanvas,
}: UseWhiteboardPagesOptions): UseWhiteboardPagesReturn {
  const [pages, setPages] = useState<WhiteboardPage[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [zoomPercent, setZoomPercent] = useState(100);
  const [pageManagerVersion, setPageManagerVersion] = useState(0);
  const pagesRef = useRef<WhiteboardPage[]>([]);
  const currentPageRef = useRef(1);
  const restoredPageRef = useRef(1);

  const pageManagerRef = useRef<PageManager | null>(null);
  const cameraConstraintsRef = useRef<CameraConstraints | null>(null);
  const pageCountRef = useRef(0);
  const hasAppliedConstraintsRef = useRef(false);

  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skipSnapRef = useRef(0);
  const [showClearPageDialog, setShowClearPageDialog] = useState(false);
  const pendingClearShapeIdsRef = useRef<TLShapeId[]>([]);
  const hasInitializedRef = useRef(false);

  const syncCameraConstraints = useCallback(
    (pageNumber: number, pageList?: WhiteboardPage[]) => {
      const cameraConstraints = cameraConstraintsRef.current;
      if (!cameraConstraints) return;
      const nextPages = pageList ?? pageManagerRef.current?.getPages() ?? [];
      cameraConstraints.update(nextPages, pageNumber);
    },
    []
  );

  const fitToPage = useCallback(
    (pageNumber: number, animated = true, pageList?: WhiteboardPage[]) => {
      const cameraConstraints = cameraConstraintsRef.current;
      if (!cameraConstraints) return;
      const nextPages = pageList ?? pageManagerRef.current?.getPages() ?? [];
      cameraConstraints.zoomToPage(nextPages, pageNumber, animated);
    },
    []
  );

  useEffect(() => {
    currentPageRef.current = currentPage;
  }, [currentPage]);

  useEffect(() => {
    if (syncReady && currentPage > 0) {
      restoredPageRef.current = currentPage;
    }
  }, [syncReady, currentPage]);

  // Force camera to page bounds after sync loads
  useEffect(() => {
    if (!editor || !syncReady) return;

    const applyInitialFit = () => {
      const pageManager = pageManagerRef.current;
      const cameraConstraints = cameraConstraintsRef.current;
      if (pageManager && cameraConstraints) {
        // Only initialize once to prevent race condition creating duplicate pages
        if (pageManager.getPages().length === 0 && !hasInitializedRef.current) {
          hasInitializedRef.current = true;
          pageManager.initialize();
        }
        const nextPages = pageManager.getPages();
        const targetPage = Math.min(restoredPageRef.current, nextPages.length) || 1;
        // Suppress pull-to-add for this programmatic camera move. Use a
        // timestamp guard (not a boolean) so burst viewport updates from
        // WhiteboardBoundsStabilizer (last burst at 32*16=512ms) can't
        // trigger auto page creation after the initial boolean is consumed.
        skipSnapRef.current = Date.now() + SKIP_SNAP_AFTER_INIT_MS;
        cameraConstraints.forceToPage(nextPages, targetPage);
        pageCountRef.current = nextPages.length;
        hasAppliedConstraintsRef.current = true;
        pagesRef.current = nextPages;
        setPagesIfChanged(setPages, nextPages);
      }
    };

    const rafId = requestAnimationFrame(applyInitialFit);
    const settleTimers = [80, 180, 360, 700].map((delay) =>
      setTimeout(applyInitialFit, delay)
    );

    return () => {
      cancelAnimationFrame(rafId);
      settleTimers.forEach((timer) => clearTimeout(timer));
    };
  }, [editor, syncReady]);

  // Reset initialization flag when editor changes
  useEffect(() => {
    if (editor) {
      hasInitializedRef.current = false;
    }
  }, [editor]);

  // Zoom tracking
  useEffect(() => {
    if (!editor) return;

    const updateZoom = () => {
      const nextZoom = Math.round(editor.getEfficientZoomLevel() * 100);
      setZoomPercent((prev) => (prev === nextZoom ? prev : nextZoom));
    };
    updateZoom();
    const unsub = editor.store.listen(updateZoom, { scope: "session" });
    return () => {
      unsub();
    };
  }, [editor]);

  // Page counter tracking via camera position
  useEffect(() => {
    if (!editor) return;
    let timerId: ReturnType<typeof setTimeout> | null = null;
    const update = () => {
      if (timerId) clearTimeout(timerId);
      timerId = setTimeout(() => {
        const pm = pageManagerRef.current;
        if (!pm) return;
        const next = pm.getCurrentPage();
        setCurrentPage((prev) => (prev === next ? prev : next));
      }, 80);
    };
    const unsub = editor.store.listen(update, { scope: "session" });
    return () => {
      if (timerId) clearTimeout(timerId);
      unsub();
    };
  }, [editor, pageManagerRef]);

  useEffect(() => {
    const cameraConstraints = cameraConstraintsRef.current;
    if (!cameraConstraints) return;

    cameraConstraints.setCanAutoCreate(canEditCanvas);

    // Keep the scrollable bounds in sync when write permission changes.
    // Canvas editors get one trailing page-height buffer for pull-to-add; viewers do not.
    if (pageManagerRef.current && hasAppliedConstraintsRef.current) {
      cameraConstraints.update(
        pageManagerRef.current.getPages(),
        currentPageRef.current
      );
    }
  }, [canEditCanvas]);

  // Initialize page manager and camera constraints
  useEffect(() => {
    if (!editor) return;

    const container = editor.getContainer();
    const rect = container?.getBoundingClientRect();
    const viewport =
      rect && rect.width > 0 && rect.height > 0
        ? {
            width: Math.round(rect.width),
            height: Math.round(rect.height),
          }
        : typeof window !== "undefined"
          ? { width: window.innerWidth, height: window.innerHeight }
          : { width: 1920, height: 1080 };

    const config = getResponsiveConfig(viewport);

    const pageDimensions: PageDimensions = {
      width: config.page.width,
      height: config.page.height,
      spacing: config.pageSpacing,
    };

    const cameraDimensions: CameraDimensions = {
      pageWidth: config.page.width,
      pageHeight: config.page.height,
      pageSpacing: config.pageSpacing,
      cameraPadding: config.cameraPadding,
    };

    const pageManager = new PageManager(editor, pageDimensions);
    const cameraConstraints = new CameraConstraints(editor, cameraDimensions);
    cameraConstraints.setCanAutoCreate(canEditCanvas);

    pageManagerRef.current = pageManager;
    cameraConstraintsRef.current = cameraConstraints;
    hasAppliedConstraintsRef.current = false;
    setPageManagerVersion((v) => v + 1);

    const updateState = () => {
      const nextPages = pageManager.getPages();
      setPagesIfChanged(setPages, nextPages);

      if (
        !hasAppliedConstraintsRef.current ||
        nextPages.length !== pageCountRef.current ||
        !arePagesEqual(pagesRef.current, nextPages)
      ) {
        cameraConstraints.update(nextPages, currentPageRef.current);
        pageCountRef.current = nextPages.length;
        hasAppliedConstraintsRef.current = true;
      }
      pagesRef.current = nextPages;
    };

    updateState();

    const unsub = editor.store.listen(() => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
      debounceTimerRef.current = setTimeout(updateState, 100);
    }, { scope: "document" });

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
      unsub();
      pageManagerRef.current = null;
      cameraConstraintsRef.current = null;
    };
  }, [editor]);

  const addPage = useCallback(() => {
    if (!canEditCanvas) return;

    const pageManager = pageManagerRef.current;
    if (!pageManager) return;

    skipSnapRef.current = Date.now() + SKIP_SNAP_AFTER_ADD_MS;
    pageManager.createPage();
    const nextPages = pageManager.getPages();
    const nextPageNumber = nextPages.length;

    cameraConstraintsRef.current?.update(nextPages, nextPageNumber);
    pageCountRef.current = nextPages.length;
    hasAppliedConstraintsRef.current = true;

    pagesRef.current = nextPages;
    setPagesIfChanged(setPages, nextPages);
    setCurrentPage(nextPageNumber);

    fitToPage(nextPageNumber, true, nextPages);
  }, [canEditCanvas, fitToPage]);

  const insertPageAfterCurrent = useCallback(() => {
    if (!canEditCanvas) return;

    const pageManager = pageManagerRef.current;
    if (!pageManager) return;

    // insertPagesAt(index) inserts before position `index` in the sorted
    // array, so passing the 1-based currentPage value puts the new page
    // immediately after the current one.
    const insertIndex = currentPageRef.current;
    const inserted = pageManager.insertPagesAt(insertIndex, 1);
    if (inserted.length === 0) return; // hit MAX_PAGES

    skipSnapRef.current = Date.now() + SKIP_SNAP_AFTER_ADD_MS;
    const nextPages = pageManager.getPages();
    const newPageNumber = insertIndex + 1;

    cameraConstraintsRef.current?.update(nextPages, newPageNumber);
    pageCountRef.current = nextPages.length;
    hasAppliedConstraintsRef.current = true;

    pagesRef.current = nextPages;
    setPagesIfChanged(setPages, nextPages);
    setCurrentPage(newPageNumber);

    fitToPage(newPageNumber, true, nextPages);
  }, [canEditCanvas, fitToPage]);

  const insertPageAfter = useCallback(
    (afterPageNumber: number) => {
      if (!canEditCanvas) return;
      const pageManager = pageManagerRef.current;
      if (!pageManager) return;

      const inserted = pageManager.insertPagesAt(afterPageNumber, 1);
      if (inserted.length === 0) return;

      skipSnapRef.current = Date.now() + SKIP_SNAP_AFTER_ADD_MS;
      const nextPages = pageManager.getPages();
      const newPageNumber = afterPageNumber + 1;

      cameraConstraintsRef.current?.update(nextPages, newPageNumber);
      pageCountRef.current = nextPages.length;
      hasAppliedConstraintsRef.current = true;

      pagesRef.current = nextPages;
      setPagesIfChanged(setPages, nextPages);
      setCurrentPage(newPageNumber);
      fitToPage(newPageNumber, true, nextPages);
    },
    [canEditCanvas, fitToPage]
  );

  const changePage = useCallback(
    (pageNumber: number) => {
      const pageManager = pageManagerRef.current;
      if (!pageManager) return;

      skipSnapRef.current = Date.now() + SKIP_SNAP_AFTER_ADD_MS;
      setCurrentPage(pageNumber);
      fitToPage(pageNumber, true, pageManager.getPages());
    },
    [fitToPage]
  );

  const onPagesChanged = useCallback(() => {
    const pageManager = pageManagerRef.current;
    if (!pageManager) return;
    const nextPages = pageManager.getPages();
    const nextCurrentPage = pageManager.getCurrentPage();
    pagesRef.current = nextPages;
    setPagesIfChanged(setPages, nextPages);
    setCurrentPage(nextCurrentPage);
    syncCameraConstraints(nextCurrentPage, nextPages);
  }, [syncCameraConstraints]);

  const clearPage = useCallback(() => {
    if (!canEditCanvas || !editor) return;

    const page = pages[currentPage - 1];
    if (!page) return;

    const idsToDelete = new Set(editor.getSortedChildIdsForParent(page.id));
    const frame = editor.getShape(page.id);
    if (frame?.type === "frame") {
      const frameLeft = frame.x;
      const frameTop = frame.y;
      const frameRight = frame.x + frame.props.w;
      const frameBottom = frame.y + frame.props.h;

      for (const shape of editor.getCurrentPageShapes()) {
        if (shape.type === "frame") continue;
        if (idsToDelete.has(shape.id)) continue;

        const bounds = editor.getShapePageBounds(shape);
        if (!bounds) continue;

        const center = bounds.center;
        const inCurrentPage =
          center.x >= frameLeft &&
          center.x <= frameRight &&
          center.y >= frameTop &&
          center.y <= frameBottom;

        if (inCurrentPage) {
          idsToDelete.add(shape.id);
        }
      }
    }

    const shapeIds = Array.from(idsToDelete);
    if (shapeIds.length === 0) return;

    pendingClearShapeIdsRef.current = shapeIds;
    setShowClearPageDialog(true);
  }, [canEditCanvas, editor, pages, currentPage]);

  const handleClearPageConfirmed = useCallback(() => {
    if (!editor) return;
    const shapeIds = pendingClearShapeIdsRef.current;
    if (shapeIds.length === 0) return;
    editor.deleteShapes(shapeIds);
    pendingClearShapeIdsRef.current = [];
  }, [editor]);

  const zoomIn = useCallback(() => {
    if (!editor) return;
    editor.zoomIn(undefined, { animation: { duration: 140 } });
  }, [editor]);

  const zoomOut = useCallback(() => {
    if (!editor) return;
    editor.zoomOut(undefined, { animation: { duration: 140 } });
  }, [editor]);

  const zoomToPage = useCallback(() => {
    fitToPage(currentPageRef.current, true);
  }, [fitToPage]);

  return {
    pages,
    currentPage,
    pageManagerRef,
    cameraConstraintsRef,
    currentPageRef,
    skipSnapRef,
    addPage,
    insertPageAfterCurrent,
    insertPageAfter,
    changePage,
    onPagesChanged,
    clearPage: canEditCanvas ? clearPage : undefined,
    pendingClearShapeIds: pendingClearShapeIdsRef,
    showClearPageDialog,
    setShowClearPageDialog,
    handleClearPageConfirmed,
    zoomPercent,
    zoomIn,
    zoomOut,
    zoomToPage,
    syncCameraConstraints,
    fitToPage,
    pageManagerVersion,
  };
}
