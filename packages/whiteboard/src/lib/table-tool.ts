import {
  BaseBoxShapeTool,
  type Editor,
  type TLShape,
  type TLStateNodeConstructor,
} from "tldraw";
import { TABLE_SHAPE_TYPE } from "./table-shape-schema";

export interface TableCreationConfig {
  rows: number;
  cols: number;
  cells: string[][];
  headerRow: boolean;
}

const pendingTableCreationConfigs = new WeakMap<Editor, TableCreationConfig>();

export function setPendingTableCreationConfig(
  editor: Editor,
  config: TableCreationConfig
) {
  pendingTableCreationConfigs.set(editor, config);
}

export const TableTool: TLStateNodeConstructor = class TableTool extends BaseBoxShapeTool {
  static override id = "table";
  static override isLockable = false;

  override shapeType = TABLE_SHAPE_TYPE;
  private unregisterCreateHandler?: () => void;

  override onEnter() {
    this.unregisterCreateHandler = this.editor.sideEffects.registerAfterCreateHandler(
      "shape",
      (shape, source) => {
        if (source !== "user" || shape.type !== TABLE_SHAPE_TYPE) return;
        if (this.editor.inputs.getIsDragging()) return;

        queueMicrotask(() => {
          if (this.editor.getShape(shape.id)) {
            this.editor.setEditingShape(shape.id);
          }
        });
      }
    );
  }

  override onExit() {
    this.unregisterCreateHandler?.();
    this.unregisterCreateHandler = undefined;
  }

  override onCreate(shape: TLShape | null) {
    if (!shape) return;

    const config = pendingTableCreationConfigs.get(this.editor);
    if (config && shape.type === TABLE_SHAPE_TYPE) {
      this.editor.updateShape({
        id: shape.id,
        type: shape.type,
        props: config,
      });
      pendingTableCreationConfigs.delete(this.editor);
    }

    this.editor.setEditingShape(shape.id);
  }
};
