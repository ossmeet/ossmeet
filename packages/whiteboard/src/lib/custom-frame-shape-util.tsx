import { FrameShapeUtil, useValue, type TLFrameShape } from "tldraw";
import {
  getBackgroundStyle,
  parsePageBackground,
} from "./page-background";

function isPageFrame(shape: TLFrameShape) {
  return (shape.meta as Record<string, unknown> | undefined)?.isPageFrame === true;
}

function PageFrameComponent({
  editor,
  shape,
}: {
  editor: CustomFrameShapeUtil["editor"];
  shape: TLFrameShape;
}) {
  const isCreating = useValue(
    "is creating this shape",
    () => {
      const resizingState = editor.getStateDescendant("select.resizing");
      if (!resizingState || !resizingState.getIsActive()) return false;
      const info = (resizingState as typeof resizingState & { info: { isCreating: boolean } })
        ?.info;
      return !!(info?.isCreating && editor.getOnlySelectedShapeId() === shape.id);
    },
    [editor, shape.id]
  );
  const pageNumber = shape.props.name.replace(/^Page\s+/i, "");

  return (
    <div
      className={`tl-frame__body${isCreating ? " tl-frame__creating" : ""}`}
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        width: shape.props.w,
        height: shape.props.h,
        ...getBackgroundStyle(parsePageBackground(shape.meta?.background)),
        boxShadow: "0 4px 24px rgba(0,0,0,0.3)",
        overflow: "hidden",
        pointerEvents: "none",
      }}
    >
      {shape.props.name && (
        <div
          style={{
            position: "absolute",
            top: 16,
            left: 16,
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "4px 12px",
            borderRadius: 9999,
            background: "rgba(255, 255, 255, 0.8)",
            backdropFilter: "blur(12px)",
            WebkitBackdropFilter: "blur(12px)",
            boxShadow:
              "0 2px 10px rgba(0,0,0,0.05), 0 1px 3px rgba(0,0,0,0.03), inset 0 0 0 1px rgba(0,0,0,0.05), inset 0 1px 0 rgba(255,255,255,0.7)",
            color: "#3f3f46",
            fontFamily: "Inter, system-ui, sans-serif",
            fontSize: 14,
            fontWeight: 600,
            userSelect: "none",
            pointerEvents: "none",
          }}
        >
          <span style={{ opacity: 0.5, fontWeight: 500, letterSpacing: "0.02em" }}>
            PAGE
          </span>
          <span>{pageNumber}</span>
        </div>
      )}
    </div>
  );
}

/**
 * Overrides tldraw's default FrameShapeUtil for page frames (identified by
 * meta.isPageFrame === true). Page frames render as a transparent rect so the
 * page background and shadow from PageShadows show through. Frames still clip
 * their child shapes to the page bounds.
 *
 * Non-page frames (user-created) fall through to the default rendering.
 */
export class CustomFrameShapeUtil extends FrameShapeUtil {
  override component(shape: TLFrameShape) {
    if (!isPageFrame(shape)) {
      return super.component(shape);
    }

    return <PageFrameComponent editor={this.editor} shape={shape} />;
  }
}
