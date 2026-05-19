import { Box, type Editor, type TLParentId, type TLShapeId } from "tldraw";

function unionBounds(
  boundsList: Array<{ x: number; y: number; w: number; h: number }>
): { x: number; y: number; w: number; h: number } | null {
  if (boundsList.length === 0) return null;

  let minX = boundsList[0].x;
  let minY = boundsList[0].y;
  let maxX = boundsList[0].x + boundsList[0].w;
  let maxY = boundsList[0].y + boundsList[0].h;

  for (let i = 1; i < boundsList.length; i += 1) {
    const b = boundsList[i];
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.w);
    maxY = Math.max(maxY, b.y + b.h);
  }

  return {
    x: minX,
    y: minY,
    w: Math.max(1, maxX - minX),
    h: Math.max(1, maxY - minY),
  };
}

export async function exportWhiteboardToPng(
  editor: Editor,
  pageIds: TLShapeId[]
): Promise<Blob> {
  if (pageIds.length === 0) {
    throw new Error("No whiteboard pages to export");
  }

  const orderedShapes = editor.getCurrentPageShapesSorted();
  const nonFrameShapes = orderedShapes.filter((shape) => shape.type !== "frame");
  const nonFrameEntries = nonFrameShapes
    .map((shape) => {
      const bounds = editor.getShapePageBounds(shape.id);
      return bounds
        ? { id: shape.id, bounds, parentId: shape.parentId }
        : null;
    })
    .filter(
      (
        entry
      ): entry is {
        id: TLShapeId;
        bounds: Box;
        parentId: TLParentId;
      } => Boolean(entry)
    );

  const exportShapeIds = new Set<TLShapeId>();
  const exportBounds: Array<{ x: number; y: number; w: number; h: number }> = [];

  for (const frameId of pageIds) {
    const frameBounds = editor.getShapePageBounds(frameId);
    if (!frameBounds) continue;

    exportShapeIds.add(frameId);
    exportBounds.push({
      x: frameBounds.x,
      y: frameBounds.y,
      w: frameBounds.w,
      h: frameBounds.h,
    });

    for (const entry of nonFrameEntries) {
      if (entry.parentId === frameId) {
        exportShapeIds.add(entry.id);
        exportBounds.push({
          x: entry.bounds.x,
          y: entry.bounds.y,
          w: entry.bounds.w,
          h: entry.bounds.h,
        });
        continue;
      }

      // Include loose shapes whose center falls within the frame
      const cx = entry.bounds.x + entry.bounds.w / 2;
      const cy = entry.bounds.y + entry.bounds.h / 2;
      if (
        cx >= frameBounds.x &&
        cx <= frameBounds.x + frameBounds.w &&
        cy >= frameBounds.y &&
        cy <= frameBounds.y + frameBounds.h
      ) {
        exportShapeIds.add(entry.id);
        exportBounds.push({
          x: entry.bounds.x,
          y: entry.bounds.y,
          w: entry.bounds.w,
          h: entry.bounds.h,
        });
      }
    }
  }

  const mergedBounds = unionBounds(exportBounds);
  if (!mergedBounds || exportShapeIds.size === 0) {
    throw new Error("No whiteboard content to export");
  }

  const image = await editor.toImage(Array.from(exportShapeIds), {
    format: "png",
    bounds: new Box(mergedBounds.x, mergedBounds.y, mergedBounds.w, mergedBounds.h),
    padding: 16,
    background: true,
    pixelRatio: 1,
  });

  return image.blob;
}
