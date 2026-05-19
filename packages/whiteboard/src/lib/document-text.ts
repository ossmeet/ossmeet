export const DOCUMENT_TEXT_HORIZONTAL_PADDING = 72;
export const MIN_DOCUMENT_TEXT_WIDTH = 180;

export interface DocumentTextBoxInput {
  frameWidth: number;
  x: number;
}

export interface DocumentTextBoxLayout {
  width: number;
  x: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Converts a click-to-type text shape into a document-style text box that stays
 * within the page margins while preserving the user's insertion point.
 */
export function getDocumentTextBoxLayout({
  frameWidth,
  x,
}: DocumentTextBoxInput): DocumentTextBoxLayout {
  const padding = Math.min(
    DOCUMENT_TEXT_HORIZONTAL_PADDING,
    Math.max(0, (frameWidth - MIN_DOCUMENT_TEXT_WIDTH) / 2)
  );
  const maxWidth = Math.max(MIN_DOCUMENT_TEXT_WIDTH, frameWidth - padding * 2);
  const maxX = Math.max(padding, frameWidth - padding - MIN_DOCUMENT_TEXT_WIDTH);
  const nextX = clamp(x, padding, maxX);
  const remainingWidth = frameWidth - padding - nextX;

  return {
    x: nextX,
    width: Math.max(MIN_DOCUMENT_TEXT_WIDTH, Math.min(maxWidth, remainingWidth)),
  };
}
