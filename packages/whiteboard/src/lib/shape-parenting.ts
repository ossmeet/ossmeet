import type { Editor, TLFrameShape, TLShapeId, TLTextShape } from "tldraw";
import type { PageManager } from "./page-manager";
import { getDocumentTextBoxLayout } from "./document-text";

function findFrameForPoint(
  editor: Editor,
  pageManager: PageManager | null,
  x: number,
  y: number
): TLShapeId | null {
  if (!pageManager) return null;

  const pages = pageManager.getPages();
  if (pages.length === 0) return null;

  for (const page of pages) {
    const frameTop = page.y;
    const frameBottom = page.y + page.height;
    const frame = editor.getShape(page.id);
    if (
      frame?.type === "frame" &&
      x >= frame.x &&
      x < frame.x + frame.props.w &&
      y >= frameTop &&
      y < frameBottom
    ) {
      return page.id;
    }
  }

  return null;
}

function reparentShapeToFrame(
  editor: Editor,
  shapeId: TLShapeId,
  getPageManager: () => PageManager | null
): void {
  const shape = editor.getShape(shapeId);
  if (!shape) return;
  if (shape.type === "frame") return;

  const parent = editor.getShape(shape.parentId);
  let frameId: TLShapeId | null = null;

  if (parent?.type === "frame") {
    frameId = parent.id;
  } else if (parent?.type === "group") {
    // Shape is inside a group. Don't extract it; the group itself will be
    // reparented to the frame, bringing its children along.
    return;
  } else {
    const bounds = editor.getShapePageBounds(shapeId);
    if (!bounds) return;

    frameId = findFrameForPoint(editor, getPageManager(), bounds.center.x, bounds.center.y);
    if (!frameId) return;

    editor.reparentShapes([shapeId], frameId);
  }

  normalizeTextShapeToFrame(editor, shapeId, frameId);
}

function normalizeTextShapeToFrame(
  editor: Editor,
  shapeId: TLShapeId,
  frameId: TLShapeId
): void {
  const shape = editor.getShape(shapeId);
  const frame = editor.getShape(frameId);
  if (!shape || shape.type !== "text" || !frame || frame.type !== "frame")
    return;

  const textShape = shape as TLTextShape;
  const frameShape = frame as TLFrameShape;

  if (!textShape.props.autoSize) return;

  const layout = getDocumentTextBoxLayout({
    frameWidth: frameShape.props.w,
    x: textShape.x,
  });

  const nextTextAlign =
    textShape.props.textAlign === "middle"
      ? "start"
      : textShape.props.textAlign;

  const widthChanged = Math.abs(textShape.props.w - layout.width) > 0.5;
  const xChanged = Math.abs(textShape.x - layout.x) > 0.5;
  const alignChanged = textShape.props.textAlign !== nextTextAlign;

  if (!widthChanged && !xChanged && !alignChanged) return;

  editor.updateShapes([
    {
      id: textShape.id,
      type: "text",
      x: layout.x,
      props: {
        autoSize: false,
        w: layout.width,
        textAlign: nextTextAlign,
      },
    },
  ]);
}

/**
 * Auto-parents user-created shapes to the current frame for clipping.
 */
export function registerShapeParentingSideEffect(
  editor: Editor,
  getPageManager: () => PageManager | null
): () => void {
  const pendingShapes = new Set<TLShapeId>();
  let rafId: number | null = null;

  const processPendingShapes = () => {
    rafId = null;

    const isDrawing =
      editor.inputs.getIsPointing() || editor.inputs.getIsDragging();

    if (isDrawing) {
      rafId = requestAnimationFrame(processPendingShapes);
      return;
    }

    for (const shapeId of pendingShapes) {
      reparentShapeToFrame(editor, shapeId, getPageManager);
    }
    pendingShapes.clear();
  };

  const unregister = editor.sideEffects.registerAfterCreateHandler(
    "shape",
    (shape, source) => {
      if (source !== "user") return;
      if (shape.type === "frame") return;

      pendingShapes.add(shape.id);

      if (rafId === null) {
        rafId = requestAnimationFrame(processPendingShapes);
      }
    }
  );

  const unregisterEditing = editor.sideEffects.registerAfterChangeHandler(
    "instance_page_state",
    (prev, next) => {
      if (prev.editingShapeId === next.editingShapeId || !next.editingShapeId)
        return;
      reparentShapeToFrame(editor, next.editingShapeId, getPageManager);
    }
  );

  return () => {
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    // Process any remaining pending shapes synchronously before cleanup
    // so shapes created just before unmount are not left orphaned.
    for (const shapeId of pendingShapes) {
      try {
        reparentShapeToFrame(editor, shapeId, getPageManager);
      } catch {
        // Editor may be tearing down; ignore write errors during cleanup
      }
    }
    pendingShapes.clear();
    unregister();
    unregisterEditing();
  };
}

/**
 * Reparents newly-created top-level shapes into the specified frame. Only moves
 * shapes whose parent is the current page; children inside groups inherit the
 * parent's frame automatically.
 */
export function reparentNewShapesToFrame(
  editor: Editor,
  newShapeIds: TLShapeId[],
  frameId: TLShapeId
): void {
  const pageId = editor.getCurrentPageId();
  const topLevelIds = newShapeIds.filter((id) => {
    const shape = editor.getShape(id);
    return shape && shape.parentId === pageId;
  });
  if (topLevelIds.length > 0) {
    editor.reparentShapes(topLevelIds, frameId);
  }
}

/**
 * Re-parents all orphaned shapes to their appropriate frames.
 */
export function reparentOrphanedShapes(
  editor: Editor,
  getPageManager: () => PageManager | null
): void {
  const shapes = editor.getCurrentPageShapes();
  const idsByFrame = new Map<TLShapeId, TLShapeId[]>();

  for (const shape of shapes) {
    if (shape.type === "frame") continue;

    const parent = editor.getShape(shape.parentId);
    if (parent?.type === "frame") {
      normalizeTextShapeToFrame(editor, shape.id, parent.id);
      continue;
    }

    const bounds = editor.getShapePageBounds(shape.id);
    if (!bounds) continue;

    const frameId = findFrameForPoint(editor, getPageManager(), bounds.center.x, bounds.center.y);
    if (!frameId) continue;

    const ids = idsByFrame.get(frameId);
    if (ids) {
      ids.push(shape.id);
    } else {
      idsByFrame.set(frameId, [shape.id]);
    }
  }

  for (const [frameId, shapeIds] of idsByFrame) {
    editor.reparentShapes(shapeIds, frameId);
    for (const shapeId of shapeIds) {
      normalizeTextShapeToFrame(editor, shapeId, frameId);
    }
  }
}
