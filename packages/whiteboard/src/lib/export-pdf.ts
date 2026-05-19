import { Box, type Editor, type TLShapeId, type TLParentId, type TLAssetId } from "tldraw";
import type { PDFPage, PDFImage } from "pdf-lib";
import { WHITEBOARD_CONFIG } from "./constants";
import { PDF_A4_WIDTH_PT, fitContained, unionBounds } from "./pdf-geometry";

function drawImageContained(
  page: PDFPage,
  image: PDFImage,
  pageWidth: number,
  pageHeight: number,
) {
  const fit = fitContained(image.width, image.height, pageWidth, pageHeight);
  page.drawImage(image, {
    x: fit.x,
    y: fit.y,
    width: fit.width,
    height: fit.height,
  });
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

async function prefetchImageAssets(
  editor: Editor,
  shapeIds: TLShapeId[],
): Promise<Map<TLAssetId, string>> {
  const cache = new Map<TLAssetId, string>();
  const seenAssetIds = new Set<TLAssetId>();

  const fetchJobs: { assetId: TLAssetId; src: string }[] = [];

  for (const id of shapeIds) {
    const shape = editor.getShape(id);
    if (!shape || shape.type !== "image") continue;
    const assetId = (shape.props as { assetId?: TLAssetId }).assetId;
    if (!assetId || seenAssetIds.has(assetId)) continue;
    seenAssetIds.add(assetId);

    const asset = editor.getAsset(assetId);
    if (!asset) continue;
    const src = asset.props.src as string | undefined;
    if (!src || src.startsWith("data:")) continue;

    fetchJobs.push({ assetId, src });
  }

  const results = await Promise.allSettled(
    fetchJobs.map(async ({ assetId, src }) => {
      const response = await fetch(src, { credentials: "include" });
      if (!response.ok) return;
      const contentType = response.headers.get("content-type") ?? "";
      if (!contentType.startsWith("image/")) return;
      const blob = await response.blob();
      cache.set(assetId, await blobToDataUrl(blob));
    }),
  );

  // Log any failures for debugging but don't block export
  for (const result of results) {
    if (result.status === "rejected") {
      // tldraw's pipeline will retry with the URL
    }
  }

  return cache;
}

/**
 * Core PDF builder — renders the whiteboard content into a PDF and returns
 * the Blob. Pass frame shape IDs as `pageIds` (one frame = one PDF page).
 * If no frames exist, falls back to exporting all content as a single page.
 *
 * `setPrefetchOverride` lets the caller's TLAssetStore.resolve return
 * prefetched data URLs during export without mutating tldraw internals or
 * broadcasting temporary asset URLs to collaborators.
 */
export async function buildWhiteboardPdfBlob(
  editor: Editor,
  pageIds: TLShapeId[],
  onProgress?: (current: number, total: number) => void,
  setPrefetchOverride?: (map: Map<TLAssetId, string> | null) => void,
): Promise<Blob> {
  const { PDFDocument } = await import("pdf-lib");
  const pdfDoc = await PDFDocument.create();

  const orderedShapes = editor.getCurrentPageShapesSorted();
  const drawableShapes = orderedShapes.filter(
    (shape) => shape.type !== "frame",
  );
  const drawableShapeEntries = drawableShapes
    .map((shape) => {
      const bounds = editor.getShapePageBounds(shape.id);
      return bounds
        ? { id: shape.id, bounds, parentId: shape.parentId }
        : null;
    })
    .filter(
      (
        entry,
      ): entry is {
        id: TLShapeId;
        bounds: Box;
        parentId: TLParentId;
      } => Boolean(entry),
    );

  const allDrawableIds = drawableShapeEntries.map((e) => e.id);
  const prefetched = await prefetchImageAssets(editor, allDrawableIds);
  setPrefetchOverride?.(prefetched);

  let exportedPageCount = 0;
  const EXPORT_BATCH_SIZE = 5;

  const isMobile =
    typeof navigator !== "undefined" &&
    /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
  const exportPixelRatio =
    pageIds.length > 20 ? 1 : isMobile && pageIds.length > 10 ? 1.5 : 2;

  try {
    for (
      let batchStart = 0;
      batchStart < pageIds.length;
      batchStart += EXPORT_BATCH_SIZE
    ) {
      const batchEnd = Math.min(
        batchStart + EXPORT_BATCH_SIZE,
        pageIds.length,
      );

      for (let index = batchStart; index < batchEnd; index += 1) {
        const frameId = pageIds[index];
        const frameBounds = editor.getShapePageBounds(frameId);
        const frameShape = editor.getShape(frameId);
        if (!frameBounds || !frameShape) continue;

        const frameAspectRatio =
          frameShape.type === "frame"
            ? (frameShape.props as { h: number }).h /
              (frameShape.props as { w: number }).w
            : WHITEBOARD_CONFIG.PAGE_HEIGHT / WHITEBOARD_CONFIG.PAGE_WIDTH;
        const pdfPageWidth = PDF_A4_WIDTH_PT;
        const pdfPageHeight = pdfPageWidth * frameAspectRatio;

        const pageShapeEntries = drawableShapeEntries.filter((entry) => {
          if (entry.parentId === frameId) return true;
          const cx = entry.bounds.x + entry.bounds.w / 2;
          const cy = entry.bounds.y + entry.bounds.h / 2;
          return (
            cx >= frameBounds.x &&
            cx <= frameBounds.x + frameBounds.w &&
            cy >= frameBounds.y &&
            cy <= frameBounds.y + frameBounds.h
          );
        });

        if (pdfPageWidth <= 0 || pdfPageHeight <= 0) {
          continue;
        }

        const pageShapeIds = pageShapeEntries.map((entry) => entry.id);
        if (pageShapeIds.length === 0) {
          pdfDoc.addPage([pdfPageWidth, pdfPageHeight]);
          exportedPageCount += 1;
          onProgress?.(exportedPageCount, pageIds.length);
          continue;
        }

        try {
          const exportBox = new Box(
            frameBounds.x,
            frameBounds.y,
            frameBounds.w,
            frameBounds.h,
          );

          const image = await editor.toImage(pageShapeIds, {
            format: "png",
            bounds: exportBox,
            padding: 0,
            background: true,
            pixelRatio: exportPixelRatio,
          });

          const pngBytes = await image.blob.arrayBuffer();
          const pngImage = await pdfDoc.embedPng(pngBytes);

          const page = pdfDoc.addPage([pdfPageWidth, pdfPageHeight]);
          drawImageContained(page, pngImage, pdfPageWidth, pdfPageHeight);
          exportedPageCount += 1;
        } catch (pageErr) {
          console.warn(`[PDF Export] Page ${index + 1} failed, adding blank page:`, pageErr);
          pdfDoc.addPage([pdfPageWidth, pdfPageHeight]);
          exportedPageCount += 1;
        }

        onProgress?.(exportedPageCount, pageIds.length);
      }
    }

    if (exportedPageCount === 0 && drawableShapeEntries.length > 0) {
      const boundsForUnion = drawableShapeEntries.map((entry) => ({
        x: entry.bounds.x,
        y: entry.bounds.y,
        w: entry.bounds.w,
        h: entry.bounds.h,
      }));
      const fallbackBounds = unionBounds(boundsForUnion);
      if (fallbackBounds) {
        const shapeIds = drawableShapeEntries.map((entry) => entry.id);
        const fallbackBox = new Box(
          fallbackBounds.x,
          fallbackBounds.y,
          fallbackBounds.w,
          fallbackBounds.h,
        );
        const image = await editor.toImage(shapeIds, {
          format: "png",
          bounds: fallbackBox,
          padding: 16,
          background: true,
          pixelRatio: 1.5,
        });

        const pngBytes = await image.blob.arrayBuffer();
        const pngImage = await pdfDoc.embedPng(pngBytes);

        const contentAspect = fallbackBounds.h / fallbackBounds.w;
        const fallbackWidth = PDF_A4_WIDTH_PT;
        const fallbackHeight = fallbackWidth * contentAspect;
        const page = pdfDoc.addPage([fallbackWidth, fallbackHeight]);
        drawImageContained(page, pngImage, fallbackWidth, fallbackHeight);
        exportedPageCount = 1;
      }
    }
  } finally {
    setPrefetchOverride?.(null);
  }

  if (exportedPageCount === 0) {
    throw new Error("No whiteboard content to export");
  }

  const pdfBytes = await pdfDoc.save();
  return new Blob([pdfBytes.buffer as ArrayBuffer], { type: "application/pdf" });
}

/**
 * Generate a PDF from the whiteboard and trigger a browser download.
 */
export async function exportWhiteboardToPdf(
  editor: Editor,
  pageIds: TLShapeId[],
  fileName: string,
  onProgress?: (current: number, total: number) => void,
  options?: { download?: boolean; setPrefetchOverride?: (map: Map<TLAssetId, string> | null) => void },
): Promise<Blob> {
  const blob = await buildWhiteboardPdfBlob(editor, pageIds, onProgress, options?.setPrefetchOverride);

  if (options?.download === false) {
    return blob;
  }

  const safeFileName = fileName.replace(/[/\\<>:"|?*\x00-\x1f]/g, "_") || "whiteboard.pdf";
  const url = URL.createObjectURL(blob);

  try {
    // Prefer File System Access API when available (Chromium 86+).
    // Gives a native save dialog with user-chosen location.
    const win = globalThis as unknown as Record<string, unknown>;
    if (typeof win.showSaveFilePicker === "function") {
      try {
        const picker = win.showSaveFilePicker as (opts: {
          suggestedName: string;
          types: { description: string; accept: Record<string, string[]> }[];
        }) => Promise<{ createWritable(): Promise<{ write(data: Blob): Promise<void>; close(): Promise<void> }> }>;
        const handle = await picker({
          suggestedName: safeFileName,
          types: [{ description: "PDF", accept: { "application/pdf": [".pdf"] } }],
        });
        const writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();
        URL.revokeObjectURL(url);
        return blob;
      } catch (e) {
        if (e instanceof Error && e.name === "AbortError") {
          URL.revokeObjectURL(url);
          return blob;
        }
      }
    }

    const link = document.createElement("a");
    link.href = url;

    if ("download" in link) {
      link.download = safeFileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } else {
      // Fallback for browsers without download attribute (older Safari)
      window.open(url, "_blank");
    }

    // Delay revoke so the browser has time to start the download
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
    return blob;
  } catch (err) {
    URL.revokeObjectURL(url);
    throw err;
  }
}
