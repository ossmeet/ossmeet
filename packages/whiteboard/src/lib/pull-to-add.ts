export const AUTO_ADD_PAGE_PULL_DISTANCE = 140;
export const PULL_TO_ADD_INDICATOR_MIN_PROGRESS = 0.08;
export const FIT_WIDTH_ZOOM_MIN_RATIO = 0.75;
export const FIT_WIDTH_ZOOM_MAX_RATIO = 1.3;

export function getPullToAddDistance(lastPageBottom: number, viewportBottom: number): number {
  return Math.max(0, viewportBottom - lastPageBottom);
}

export function getPullToAddProgress(lastPageBottom: number, viewportBottom: number): number {
  return Math.min(1, getPullToAddDistance(lastPageBottom, viewportBottom) / AUTO_ADD_PAGE_PULL_DISTANCE);
}

export function isPullToAddReady(lastPageBottom: number, viewportBottom: number): boolean {
  return getPullToAddDistance(lastPageBottom, viewportBottom) >= AUTO_ADD_PAGE_PULL_DISTANCE;
}

export function isNearFitWidthZoom(currentZoom: number, fitWidthZoom: number): boolean {
  if (!Number.isFinite(currentZoom) || !Number.isFinite(fitWidthZoom) || fitWidthZoom <= 0) {
    return false;
  }

  const ratio = currentZoom / fitWidthZoom;
  return ratio >= FIT_WIDTH_ZOOM_MIN_RATIO && ratio <= FIT_WIDTH_ZOOM_MAX_RATIO;
}
