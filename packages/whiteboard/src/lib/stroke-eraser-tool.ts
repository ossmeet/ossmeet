import {
  StateNode,
  type TLShape,
  type TLPointerEventInfo,
  type TLShapeId,
  type TLStateNodeConstructor,
} from "tldraw";

interface WholeShapeEraserConfig {
  id: string;
  historyKey: string;
  hitMargin: number;
  canErase?: (shape: TLShape) => boolean;
}

function getWholeShapeHits(
  state: StateNode,
  erasedIds: Set<TLShapeId>,
  hitMargin: number,
  canErase: (shape: TLShape) => boolean
) {
  const { currentPagePoint } = state.editor.inputs;

  return state.editor
    .getCurrentPageRenderingShapesSorted()
    .filter((shape) => {
      if (shape.type === "frame") return false;
      if (shape.isLocked) return false;
      if (erasedIds.has(shape.id)) return false;
      if (!canErase(shape)) return false;

      return state.editor.isPointInShape(shape, currentPagePoint, {
        hitInside: true,
        margin: hitMargin,
      });
    });
}

function createWholeShapeEraserTool({
  id,
  historyKey,
  hitMargin,
  canErase = () => true,
}: WholeShapeEraserConfig): TLStateNodeConstructor {
  class WholeShapeEraserIdle extends StateNode {
    static override id = "idle";

    override onPointerDown(info: TLPointerEventInfo) {
      this.parent.transition("erasing", info);
    }

    override onEnter() {
      this.editor.setCursor({ type: "cross", rotation: 0 });
    }
  }

  class WholeShapeEraserErasing extends StateNode {
    static override id = "erasing";

    private erasedIds = new Set<TLShapeId>();

    override onEnter() {
      this.erasedIds.clear();
      this.editor.markHistoryStoppingPoint(historyKey);
      this.eraseAtPointer();
    }

    override onPointerMove() {
      this.eraseAtPointer();
    }

    override onPointerUp() {
      this.erasedIds.clear();
      this.parent.transition("idle");
    }

    override onCancel() {
      this.editor.undo();
      this.erasedIds.clear();
      this.parent.transition("idle");
    }

    private eraseAtPointer() {
      const hitShapes = getWholeShapeHits(
        this,
        this.erasedIds,
        hitMargin,
        canErase
      );
      if (hitShapes.length === 0) return;

      const idsToDelete = hitShapes.map((shape) => {
        this.erasedIds.add(shape.id);
        return shape.id;
      });

      this.editor.deleteShapes(idsToDelete);
    }
  }

  return class WholeShapeEraserTool extends StateNode {
    static override id = id;
    static override initial = "idle";
    static override children() {
      return [WholeShapeEraserIdle, WholeShapeEraserErasing];
    }
    static override isLockable = false;

    override onEnter() {
      this.editor.setCursor({ type: "cross", rotation: 0 });
    }
  };
}

export const StrokeEraserTool = createWholeShapeEraserTool({
  id: "stroke-eraser",
  historyKey: "stroke-erase",
  hitMargin: 4,
  canErase: (shape) => shape.type === "draw" || shape.type === "highlight",
});
