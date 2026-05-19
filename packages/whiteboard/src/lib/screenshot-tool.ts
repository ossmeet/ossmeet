import {
  atom,
  Box,
  AssetRecordType,
  createShapeId,
  StateNode,
  type TLParentId,
  type TLPointerEventInfo,
  type TLStateNodeConstructor,
} from "tldraw";

// Reactive atom for the in-progress selection rectangle (page coordinates).
// Read by ScreenshotBrushOverlay to draw the dashed selection rect.
export const screenshotBrushAtom = atom<{
  x: number;
  y: number;
  w: number;
  h: number;
} | null>("screenshot-brush", null);

// Per-editor upload function registry so multiple whiteboard instances
// don't share a single module-level _uploadFile variable.
const uploadRegistry = new WeakMap<object, ((file: File) => Promise<{ url: string }>) | null>();

export function setScreenshotUploadFile(
  key: object,
  fn: ((file: File) => Promise<{ url: string }>) | null
) {
  uploadRegistry.set(key, fn);
}

function getUploadFile(key: object) {
  return uploadRegistry.get(key) ?? null;
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

// ─── States ──────────────────────────────────────────────────────────────────

class ScreenshotIdle extends StateNode {
  static override id = "idle";

  override onEnter() {
    this.editor.setCursor({ type: "cross", rotation: 0 });
    screenshotBrushAtom.set(null);
  }

  override onPointerDown(info: TLPointerEventInfo) {
    this.parent.transition("selecting", info);
  }
}

class ScreenshotSelecting extends StateNode {
  static override id = "selecting";

  private startPoint = { x: 0, y: 0 };

  override onEnter() {
    const { currentPagePoint } = this.editor.inputs;
    this.startPoint = { x: currentPagePoint.x, y: currentPagePoint.y };
    this._updateBrush();
  }

  override onPointerMove() {
    this._updateBrush();
  }

  override async onPointerUp() {
    const brush = screenshotBrushAtom.get();
    screenshotBrushAtom.set(null);
    this.parent.transition("idle");

    // Ignore tiny drags (accidental clicks)
    if (!brush || brush.w < 4 || brush.h < 4) return;

    try {
      await this._captureRegion(brush);
    } catch (err) {
      console.error("[ScreenshotTool] capture failed:", err);
    }
  }

  override onCancel() {
    screenshotBrushAtom.set(null);
    this.parent.transition("idle");
  }

  private _updateBrush() {
    const { currentPagePoint } = this.editor.inputs;
    const { x: sx, y: sy } = this.startPoint;
    const { x: cx, y: cy } = currentPagePoint;

    screenshotBrushAtom.set({
      x: Math.min(sx, cx),
      y: Math.min(sy, cy),
      w: Math.abs(cx - sx),
      h: Math.abs(cy - sy),
    });
  }

  private async _captureRegion(brush: {
    x: number;
    y: number;
    w: number;
    h: number;
  }) {
    const bounds = new Box(brush.x, brush.y, brush.w, brush.h);

    // Collect all shapes whose masked bounds intersect the selection.
    // This includes PDF page images, drawings, text, etc.
    const shapes = this.editor.getCurrentPageShapes().filter((shape) => {
      if (shape.type === "frame") return false;
      try {
        const sb = this.editor.getShapeMaskedPageBounds(shape);
        return sb ? bounds.collides(sb) : false;
      } catch {
        return false;
      }
    });

    const { blob, width, height } = await this.editor.toImage(shapes, {
      bounds,
      format: "png",
      pixelRatio: 2,
      background: true,
      padding: 0,
    });

    // Upload if possible, otherwise embed as data URL (works offline / no upload configured)
    // use per-editor upload function from registry
    let src: string;
    const file = new File([blob], "screenshot.png", { type: "image/png" });
    const uploadFile = getUploadFile(this.editor);
    if (uploadFile) {
      const result = await uploadFile(file);
      src = result.url;
    } else {
      src = await blobToDataUrl(blob);
    }

    // Parent the new shape to whichever page frame contains the selection center.
    const center = bounds.center;
    let parentId: TLParentId = this.editor.getCurrentPageId();
    for (const shape of this.editor.getCurrentPageShapes()) {
      if (shape.type !== "frame") continue;
      const fb = this.editor.getShapePageBounds(shape);
      if (fb?.containsPoint(center)) {
        parentId = shape.id as TLParentId;
        break;
      }
    }

    // Convert page-space position to parent-local coordinates.
    let shapeX = bounds.x;
    let shapeY = bounds.y;
    if (parentId !== this.editor.getCurrentPageId()) {
      const parentShape = this.editor.getShape(parentId);
      if (parentShape) {
        shapeX = bounds.x - parentShape.x;
        shapeY = bounds.y - parentShape.y;
      }
    }

    const assetId = AssetRecordType.createId();
    this.editor.createAssets([
      {
        id: assetId,
        type: "image",
        typeName: "asset",
        props: {
          name: "screenshot.png",
          src,
          w: width,
          h: height,
          mimeType: "image/png",
          isAnimated: false,
          fileSize: blob.size,
        },
        meta: {},
      },
    ]);

    // Shape dimensions are in page units: toImage uses pixelRatio 2,
    // so divide pixel dimensions by 2 to get the original page-unit size.
    const shapeId = createShapeId();
    this.editor.createShape({
      id: shapeId,
      type: "image",
      parentId,
      x: shapeX,
      y: shapeY,
      props: {
        assetId,
        w: width / 2,
        h: height / 2,
      },
    });

    // Select and hand back to the select tool so the user can move the snip.
    this.editor.setCurrentTool("select");
    this.editor.setSelectedShapes([shapeId]);
  }
}

// ─── Tool ────────────────────────────────────────────────────────────────────

export const ScreenshotTool: TLStateNodeConstructor = class ScreenshotTool extends StateNode {
  static override id = "screenshot";
  static override initial = "idle";
  static override children() {
    return [ScreenshotIdle, ScreenshotSelecting];
  }
  static override isLockable = false;

  override onEnter() {
    this.editor.setCursor({ type: "cross", rotation: 0 });
  }
};
