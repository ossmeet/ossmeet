import { useEffect, useState } from "react";
import type { Editor } from "tldraw";
import type { CameraConstraints, CameraDimensions } from "./camera-constraints";
import type { PageManager, PageDimensions } from "./page-manager";
import { getResponsiveConfig } from "./responsive-config";

interface UseWhiteboardResponsiveOptions {
  editor: Editor | null;
  pageManagerRef: React.RefObject<PageManager | null>;
  cameraConstraintsRef: React.RefObject<CameraConstraints | null>;
}

export interface UseWhiteboardResponsiveReturn {
  isMobileLandscape: boolean;
}

export function useWhiteboardResponsive({
  editor,
  pageManagerRef,
  cameraConstraintsRef,
}: UseWhiteboardResponsiveOptions): UseWhiteboardResponsiveReturn {
  const [isMobileLandscape, setIsMobileLandscape] = useState(false);

  // Responsive viewport detection and dimension update
  useEffect(() => {
    if (!editor) return;

    let resizeTimeoutId: ReturnType<typeof setTimeout> | null = null;
    let pendingForceToPage = false;
    const container = editor.getContainer();
    const getViewport = () => {
      const rect = container?.getBoundingClientRect();
      const width = rect?.width ?? container?.clientWidth ?? window.innerWidth;
      const height = rect?.height ?? container?.clientHeight ?? window.innerHeight;

      return {
        width: Math.max(1, Math.round(width)),
        height: Math.max(1, Math.round(height)),
      };
    };

    const updateResponsiveDimensions = () => {
      if (typeof window === "undefined") return;
      const viewport = getViewport();

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

      const pageManager = pageManagerRef.current;
      const cameraConstraints = cameraConstraintsRef.current;
      if (pageManager) {
        pageManager.updateDimensions(pageDimensions);
      }

      if (cameraConstraints) {
        cameraConstraints.updateDimensions(cameraDimensions);
        const pages = pageManager?.getPages() ?? [];
        const currentPageNum = pageManager?.getCurrentPage() ?? 1;
        if (pages.length > 0) {
          if (editor.inputs.getIsPointing() || editor.inputs.getIsDragging()) {
            pendingForceToPage = true;
            cameraConstraints.update(pages, currentPageNum);
            return;
          }
          pendingForceToPage = false;
          cameraConstraints.forceToPage(pages, currentPageNum);
        }
      }
    };

    updateResponsiveDimensions();

    const handleResize = () => {
      if (resizeTimeoutId !== null) {
        clearTimeout(resizeTimeoutId);
      }
      resizeTimeoutId = setTimeout(() => {
        updateResponsiveDimensions();
        resizeTimeoutId = null;
      }, 150);
    };

    const resizeObserver =
      typeof ResizeObserver !== "undefined" && container
        ? new ResizeObserver(handleResize)
        : null;
    resizeObserver?.observe(container);

    const unsubscribePointer = editor.store.listen(() => {
      if (!pendingForceToPage || editor.inputs.getIsPointing() || editor.inputs.getIsDragging()) {
        return;
      }
      pendingForceToPage = false;
      handleResize();
    }, { scope: "session" });

    window.addEventListener("resize", handleResize);
    window.addEventListener("orientationchange", handleResize);
    window.visualViewport?.addEventListener("resize", handleResize);
    window.visualViewport?.addEventListener("scroll", handleResize);

    return () => {
      if (resizeTimeoutId !== null) {
        clearTimeout(resizeTimeoutId);
      }
      unsubscribePointer();
      resizeObserver?.disconnect();
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("orientationchange", handleResize);
      window.visualViewport?.removeEventListener("resize", handleResize);
      window.visualViewport?.removeEventListener("scroll", handleResize);
    };
  }, [editor, pageManagerRef, cameraConstraintsRef]);

  // Detect mobile landscape mode
  useEffect(() => {
    if (typeof window === "undefined") return;

    const checkMobileLandscape = () => {
      const isLandscape = window.innerWidth > window.innerHeight;
      const isSmallHeight = window.innerHeight < 500;
      setIsMobileLandscape(isLandscape && isSmallHeight);
    };

    checkMobileLandscape();
    window.addEventListener("resize", checkMobileLandscape);
    window.addEventListener("orientationchange", checkMobileLandscape);

    return () => {
      window.removeEventListener("resize", checkMobileLandscape);
      window.removeEventListener("orientationchange", checkMobileLandscape);
    };
  }, []);

  return { isMobileLandscape };
}
