import { useEffect, useRef } from "react";
import type { Editor, TLAssetId, TLImageShape } from "tldraw";
import type { WhiteboardPage } from "./page-manager";

const PRELOAD_WINDOW = [0, 1, -1, 2, -2];

export function usePageImagePreloader(
  editor: Editor | null,
  pages: WhiteboardPage[],
  currentPage: number,
  resolveAssetUrl?: (src: string) => string,
): void {
  const preloadedRef = useRef(new Set<string>());

  useEffect(() => {
    if (!editor || pages.length === 0 || currentPage < 1) return;

    let rafId: number | null = null;

    const preloadVisibleWindow = () => {
      for (const delta of PRELOAD_WINDOW) {
        const pageNum = currentPage + delta;
        if (pageNum < 1 || pageNum > pages.length) continue;

        const page = pages[pageNum - 1];
        if (!page) continue;

        const childIds = editor.getSortedChildIdsForParent(page.id);
        for (const childId of childIds) {
          const shape = editor.getShape(childId);
          if (!shape || shape.type !== "image") continue;

          const { assetId } = (shape as TLImageShape).props;
          if (!assetId) continue;

          const asset = editor.getAsset(assetId as TLAssetId);
          if (!asset) continue;

          let src = (asset.props as { src?: string | null }).src;
          if (!src || src.startsWith("blob:")) continue;

          if (resolveAssetUrl) {
            src = resolveAssetUrl(src);
          }

          if (preloadedRef.current.has(src)) continue;
          preloadedRef.current.add(src);

          const img = new Image();
          img.decoding = "async";
          img.fetchPriority = delta === 0 ? "high" : "low";
          img.onload = () => {
            img.onload = null;
            img.onerror = null;
          };
          img.onerror = () => {
            preloadedRef.current.delete(src);
            img.onload = null;
            img.onerror = null;
          };
          img.src = src;
        }
      }
    };

    const schedulePreload = () => {
      if (rafId !== null) return;
      rafId = requestAnimationFrame(() => {
        rafId = null;
        preloadVisibleWindow();
      });
    };

    schedulePreload();
    const unsubscribe = editor.store.listen(schedulePreload, { scope: "document" });

    return () => {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
      }
      unsubscribe();
    };
  }, [editor, pages, currentPage, resolveAssetUrl]);
}
