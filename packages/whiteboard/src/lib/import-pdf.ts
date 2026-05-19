import { AssetRecordType, type Editor, type TLShapeId } from "tldraw";
import { createShapeId } from "@tldraw/tlschema";
import type { PageManager } from "./page-manager";
import { PDF_MAX_IMPORT_SIZE, PDF_MAX_IMPORT_PAGES, fitContained } from "./pdf-geometry";
import { withPageFrameMutationAllowance } from "./protect-page-frames";
import { buildWhiteboardAssetApiPath } from "./whiteboard-asset-key";

export type PdfInsertPosition =
  | { type: "before"; page: number }
  | { type: "after"; page: number }
  | { type: "on"; page: number };

export interface PdfImportResult {
  pagesImported: number;
  pagesFailed: number;
}

interface RenderJob {
  id: string;
  pages: { width: number; height: number }[];
}

interface CommittedPage {
  index: number;
  r2Key: string;
  size: number;
}

export interface PdfImportOptions {
  editor: Editor;
  file: File;
  pageManager: PageManager;
  whiteboardUrl: string;
  token: string;
  onProgress?: (current: number, total: number) => void;
  insertPosition?: PdfInsertPosition;
  signal?: AbortSignal;
}

export async function importPdfToWhiteboard(opts: PdfImportOptions): Promise<PdfImportResult> {
  const { editor, file, pageManager, whiteboardUrl, token, onProgress, insertPosition, signal } = opts;

  const isPdf =
    file.type === "application/pdf" ||
    file.name.toLowerCase().endsWith(".pdf");
  if (!isPdf) {
    throw new Error("File must be a PDF");
  }

  if (file.size > PDF_MAX_IMPORT_SIZE) {
    throw new Error("PDF must be smaller than 50MB");
  }

  const baseUrl = whiteboardUrl.replace(/\/+$/, "");

  const renderResp = await fetch(`${baseUrl}/pdf-render`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/pdf",
    },
    body: file,
    signal,
  });

  if (!renderResp.ok) {
    const errBody = await renderResp.json().catch(() => null);
    throw new Error(
      (errBody as { error?: string })?.error ?? `Server render failed (${renderResp.status})`,
    );
  }

  const job: RenderJob = await renderResp.json();

  if (job.pages.length === 0) {
    throw new Error("PDF produced no pages");
  }

  if (job.pages.length > PDF_MAX_IMPORT_PAGES) {
    throw new Error(
      `PDF has too many pages (${job.pages.length}, max ${PDF_MAX_IMPORT_PAGES}). Please split the file.`,
    );
  }

  try {
    return await importRenderedPages({
      job,
      baseUrl,
      token,
      editor,
      fileName: file.name,
      pageManager,
      onProgress,
      insertPosition,
      signal,
    });
  } finally {
    fetch(`${baseUrl}/pdf-render/${job.id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    }).catch(() => {});
  }
}

async function commitRenderedPages(
  job: RenderJob,
  baseUrl: string,
  token: string,
  signal?: AbortSignal,
): Promise<{ committed: CommittedPage[]; failedIndices: Set<number> }> {
  const response = await fetch(`${baseUrl}/pdf-render/${job.id}/commit`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    signal,
  });

  const payload = await response.json().catch(() => null) as
    | { error?: string; pages?: CommittedPage[]; failedIndices?: number[] }
    | null;

  if (!response.ok) {
    throw new Error(payload?.error ?? `Server commit failed (${response.status})`);
  }

  const committed = Array.isArray(payload?.pages) ? payload.pages : [];
  committed.sort((a, b) => a.index - b.index);

  return {
    committed,
    failedIndices: new Set(
      Array.isArray(payload?.failedIndices) ? payload.failedIndices : [],
    ),
  };
}

interface ImportRenderedPagesOptions {
  job: RenderJob;
  baseUrl: string;
  token: string;
  editor: Editor;
  fileName: string;
  pageManager: PageManager;
  onProgress?: (current: number, total: number) => void;
  insertPosition?: PdfInsertPosition;
  signal?: AbortSignal;
}

async function importRenderedPages(opts: ImportRenderedPagesOptions): Promise<PdfImportResult> {
  const { job, baseUrl, token, editor, fileName, pageManager, onProgress, insertPosition, signal } = opts;

  const { committed, failedIndices } = await commitRenderedPages(
    job,
    baseUrl,
    token,
    signal,
  );

  if (committed.length === 0) {
    throw new Error(
      "All rendered pages failed to save. Please check your connection and try again.",
    );
  }

  let result: PdfImportResult | null = null;
  editor.run(() => {
    result = insertCommittedPages({
      job,
      committed,
      failedIndices,
      editor,
      fileName,
      pageManager,
      onProgress,
      insertPosition,
      signal,
    });
  });

  if (!result) {
    throw new Error("PDF import failed to apply to the whiteboard.");
  }

  return result;
}

interface InsertCommittedPagesOptions {
  job: RenderJob;
  committed: CommittedPage[];
  failedIndices: Set<number>;
  editor: Editor;
  fileName: string;
  pageManager: PageManager;
  onProgress?: (current: number, total: number) => void;
  insertPosition?: PdfInsertPosition;
  signal?: AbortSignal;
}

function insertCommittedPages(opts: InsertCommittedPagesOptions): PdfImportResult {
  const { job, committed, failedIndices, editor, fileName, pageManager, onProgress, insertPosition, signal } = opts;
  const totalPages = job.pages.length;
  const existingPages = pageManager.getPages();
  let insertIndex: number;
  let reuseFrameId: TLShapeId | null = null;

  if (!insertPosition) {
    insertIndex = existingPages.length;
  } else if (insertPosition.type === "before") {
    insertIndex = Math.max(0, insertPosition.page - 1);
  } else if (insertPosition.type === "after") {
    insertIndex = Math.min(existingPages.length, insertPosition.page);
  } else {
    const targetIdx = Math.max(0, insertPosition.page - 1);
    const targetPage = existingPages[targetIdx];
    if (targetPage) {
      reuseFrameId = targetPage.id;
      insertIndex = insertPosition.page;
    } else {
      insertIndex = existingPages.length;
    }
  }

  const successfulIndices = committed.map((page) => page.index);
  const framesToCreate = reuseFrameId
    ? successfulIndices.filter((index) => index !== 0).length
    : successfulIndices.length;

  let frameIds: TLShapeId[];
  if (reuseFrameId) {
    const newIds =
      framesToCreate > 0
        ? pageManager.insertPagesAt(insertIndex, framesToCreate)
        : [];
    const newFrameQueue = [...newIds];
    frameIds = [];
    for (const index of successfulIndices) {
      if (index === 0 && reuseFrameId) {
        frameIds.push(reuseFrameId);
      } else {
        const frameId = newFrameQueue.shift();
        if (frameId) frameIds.push(frameId);
      }
    }
  } else {
    frameIds = pageManager.insertPagesAt(insertIndex, framesToCreate);
  }

  if (frameIds.length === 0) {
    throw new Error(
      "No pages could be inserted (whiteboard page limit reached).",
    );
  }

  const dims = pageManager.getDimensions();
  const frameWidth = dims.width;

  const frameResizeUpdates: {
    id: TLShapeId;
    type: "frame";
    props: { h: number };
  }[] = [];

  for (let fi = 0; fi < committed.length; fi++) {
    const page = committed[fi];
    const frameId = frameIds[fi];
    if (!frameId || (fi === 0 && reuseFrameId)) continue;

    const pageInfo = job.pages[page.index];
    const pageAspect = pageInfo.width / pageInfo.height;
    const frameHeight = Math.round(frameWidth / pageAspect);

    if (Math.abs(frameHeight - dims.height) > 1) {
      frameResizeUpdates.push({
        id: frameId,
        type: "frame",
        props: { h: frameHeight },
      });
    }
  }

  if (frameResizeUpdates.length > 0) {
    editor.updateShapes(frameResizeUpdates);
    pageManager.compactPages();
  }

  const assets = committed.map((page) => ({
    id: AssetRecordType.createId(`${job.id}-${page.index}`),
    type: "image" as const,
    typeName: "asset" as const,
    props: {
      name: `${fileName}-page-${page.index + 1}.png`,
      src: buildWhiteboardAssetApiPath(page.r2Key),
      w: job.pages[page.index].width,
      h: job.pages[page.index].height,
      mimeType: "image/png",
      isAnimated: false,
      fileSize: page.size,
    },
    meta: {},
  }));
  editor.createAssets(assets);

  const shapeIds: TLShapeId[] = [];
  const shapes = [];

  for (let fi = 0; fi < committed.length; fi++) {
    signal?.throwIfAborted();
    const page = committed[fi];
    const frameId = frameIds[fi];
    if (!frameId) continue;

    const frame = editor.getShape(frameId);
    if (!frame || frame.type !== "frame") continue;

    const pageWidth = (frame.props as { w: number }).w;
    const pageHeight = (frame.props as { h: number }).h;
    const fit = fitContained(
      job.pages[page.index].width,
      job.pages[page.index].height,
      pageWidth,
      pageHeight,
    );

    const shapeId = createShapeId();
    shapeIds.push(shapeId);
    shapes.push({
      id: shapeId,
      type: "image" as const,
      parentId: frameId,
      x: fit.x,
      y: fit.y,
      isLocked: true,
      props: {
        assetId: assets[fi].id,
        w: fit.width,
        h: fit.height,
      },
    });

    onProgress?.(fi + 1, totalPages);
  }

  if (shapes.length > 0) {
    editor.createShapes(shapes);
    editor.sendToBack(shapeIds);
  }

  if (shapes.length < frameIds.length) {
    const cleanableIds = reuseFrameId
      ? frameIds.filter((frameId) => frameId !== reuseFrameId)
      : frameIds;
    const emptyFrameIds = cleanableIds.filter((frameId) => {
      const children = editor.getShape(frameId)
        ? editor.getSortedChildIdsForParent(frameId)
        : [];
      return children.length === 0;
    });
    if (emptyFrameIds.length > 0) {
      withPageFrameMutationAllowance(editor, () => {
        editor.deleteShapes(emptyFrameIds);
        pageManager.compactPages();
      });
    }
  }

  if (shapes.length === 0) {
    throw new Error(
      "All rendered pages failed to import. Please try again.",
    );
  }

  const totalFailed = failedIndices.size + (committed.length - shapes.length);
  if (totalFailed > 0) {
    console.warn(
      `[PDF Import] ${totalFailed}/${totalPages} pages failed`,
    );
  }

  return { pagesImported: shapes.length, pagesFailed: totalFailed };
}
