export const PDF_A4_WIDTH_PT = 595.28;

export const PDF_MAX_IMPORT_SIZE = 50 * 1024 * 1024; // 50 MB
export const PDF_MAX_IMPORT_PAGES = 100;

export interface FitResult {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function fitContained(
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
): FitResult {
  const scale = Math.min(dstW / srcW, dstH / srcH);
  const width = srcW * scale;
  const height = srcH * scale;
  return {
    x: (dstW - width) / 2,
    y: (dstH - height) / 2,
    width,
    height,
  };
}

export function unionBounds(
  boundsList: Array<{ x: number; y: number; w: number; h: number }>,
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
