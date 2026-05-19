import {
  BaseBoxShapeUtil,
  HTMLContainer,
  RecordProps,
  type TLShape,
  type TLResizeInfo,
} from "tldraw";
import { useCallback, useEffect, useRef } from "react";
import { normalizeMathSymbols } from "./normalize-rich-text-math";
import {
  DEFAULT_TABLE_COLS,
  DEFAULT_TABLE_HEIGHT,
  DEFAULT_TABLE_ROWS,
  DEFAULT_TABLE_WIDTH,
  MAX_TABLE_CELL_CHARS,
  MAX_TABLE_COLS,
  MAX_TABLE_ROWS,
  MIN_TABLE_COL_WIDTH,
  MIN_TABLE_ROW_HEIGHT,
  TABLE_SHAPE_PROPS,
  TABLE_SHAPE_TYPE,
} from "./table-shape-schema";

// ─── Shape type registration ────────────────────────────────────────────────

declare module "tldraw" {
  export interface TLGlobalShapePropsMap {
    [TABLE_SHAPE_TYPE]: {
      w: number;
      h: number;
      rows: number;
      cols: number;
      cells: string[][];
      headerRow: boolean;
    };
  }
}

export type TableShape = TLShape<typeof TABLE_SHAPE_TYPE>;

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeEmptyCells(rows: number, cols: number): string[][] {
  return Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => "")
  );
}

function clampRows(rows: number): number {
  return Math.max(1, Math.min(MAX_TABLE_ROWS, Math.trunc(rows)));
}

function clampCols(cols: number): number {
  return Math.max(1, Math.min(MAX_TABLE_COLS, Math.trunc(cols)));
}

function clampTableSize(
  width: number,
  height: number,
  rows: number,
  cols: number
) {
  return {
    w: Math.max(width, cols * MIN_TABLE_COL_WIDTH),
    h: Math.max(height, rows * MIN_TABLE_ROW_HEIGHT),
  };
}

export function normalizeTableCellText(value: string): string {
  return normalizeMathSymbols(value).slice(0, MAX_TABLE_CELL_CHARS);
}

/** Resize or pad a cell grid to fit new dimensions, preserving existing data. */
export function resizeCells(
  existing: string[][],
  newRows: number,
  newCols: number
): string[][] {
  const rows = clampRows(newRows);
  const cols = clampCols(newCols);
  return Array.from({ length: rows }, (_, r) =>
    Array.from({ length: cols }, (_, c) =>
      normalizeTableCellText(existing[r]?.[c] ?? "")
    )
  );
}

// ─── Component ──────────────────────────────────────────────────────────────

function TableComponent({
  shape,
  isEditing,
  showControls,
  onCellChange,
  onAddRow,
  onAddCol,
  onRemoveRow,
  onRemoveCol,
  onToggleHeader,
  onEdit,
}: {
  shape: TableShape;
  isEditing: boolean;
  showControls: boolean;
  onCellChange: (row: number, col: number, value: string) => void;
  onAddRow: () => void;
  onAddCol: () => void;
  onRemoveRow: () => void;
  onRemoveCol: () => void;
  onToggleHeader: () => void;
  onEdit: () => void;
}) {
  const { rows, cols, cells, headerRow, w, h } = shape.props;
  const cellRefs = useRef<(HTMLInputElement | null)[][]>([]);

  // Auto-focus the first cell when entering edit mode
  useEffect(() => {
    if (isEditing && cellRefs.current[0]?.[0]) {
      cellRefs.current[0][0].focus();
    }
  }, [isEditing]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent, row: number, col: number) => {
      let nextRow = row;
      let nextCol = col;

      if (e.key === "Tab") {
        e.preventDefault();
        if (e.shiftKey) {
          nextCol = col - 1;
          if (nextCol < 0) {
            nextCol = cols - 1;
            nextRow = row - 1;
          }
        } else {
          nextCol = col + 1;
          if (nextCol >= cols) {
            nextCol = 0;
            nextRow = row + 1;
          }
        }
      } else if (e.key === "ArrowDown") {
        nextRow = row + 1;
      } else if (e.key === "ArrowUp") {
        nextRow = row - 1;
      } else if (e.key === "ArrowRight" && e.currentTarget instanceof HTMLInputElement && e.currentTarget.selectionStart === e.currentTarget.value.length) {
        nextCol = col + 1;
      } else if (e.key === "ArrowLeft" && e.currentTarget instanceof HTMLInputElement && e.currentTarget.selectionStart === 0) {
        nextCol = col - 1;
      } else {
        return;
      }

      if (nextRow >= 0 && nextRow < rows && nextCol >= 0 && nextCol < cols) {
        cellRefs.current[nextRow]?.[nextCol]?.focus();
      }
    },
    [rows, cols]
  );

  // Ensure refs grid is the right size (check both dimensions)
  if (
    cellRefs.current.length !== rows ||
    (cellRefs.current[0]?.length ?? 0) !== cols
  ) {
    cellRefs.current = Array.from({ length: rows }, (_, r) =>
      Array.from({ length: cols }, (_, c) => cellRefs.current[r]?.[c] ?? null)
    );
  }

  const colWidth = w / cols;
  const headerHeight = headerRow ? 32 : 0;
  const bodyRows = headerRow ? rows - 1 : rows;
  const rowHeight = bodyRows > 0 ? (h - headerHeight) / bodyRows : h / rows;

  return (
    <div className="ossmeet-table-shape" style={{ width: w, height: h }}>
      <table
        style={{ width: "100%", height: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}
      >
        <tbody>
          {Array.from({ length: rows }, (_, r) => (
            <tr key={r}>
              {Array.from({ length: cols }, (_, c) => {
                const isHeader = headerRow && r === 0;
                const Tag = isHeader ? "th" : "td";
                return (
                  <Tag
                    key={c}
                    className={
                      isHeader
                        ? "ossmeet-table-header-cell"
                        : "ossmeet-table-cell"
                    }
                    style={{
                      width: colWidth,
                      height: isHeader ? headerHeight : rowHeight,
                    }}
                  >
                    {isEditing ? (
                      <input
                        ref={(el) => {
                          if (!cellRefs.current[r]) cellRefs.current[r] = [];
                          cellRefs.current[r][c] = el;
                        }}
                        type="text"
                        className="ossmeet-table-input"
                        value={cells[r]?.[c] ?? ""}
                        onChange={(e) =>
                          onCellChange(r, c, normalizeTableCellText(e.target.value))
                        }
                        onKeyDown={(e) => handleKeyDown(e, r, c)}
                        style={{
                          fontWeight: isHeader ? 600 : 400,
                        }}
                      />
                    ) : (
                      <span
                        className="ossmeet-table-display"
                        style={{ fontWeight: isHeader ? 600 : 400 }}
                      >
                        {cells[r]?.[c] ?? ""}
                      </span>
                    )}
                  </Tag>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>

      {/* Row/column controls visible only while editing */}
      {showControls && (
        <div
          className="ossmeet-table-controls"
          onPointerDown={(e) => e.stopPropagation()}
        >
          {!isEditing && (
            <button
              type="button"
              className="ossmeet-table-ctrl-btn"
              onClick={onEdit}
              title="Edit table cells"
            >
              Edit cells
            </button>
          )}
          <button
            type="button"
            className="ossmeet-table-ctrl-btn"
            onClick={onToggleHeader}
            title={headerRow ? "Turn off header row" : "Turn on header row"}
          >
            {headerRow ? "Header on" : "Header off"}
          </button>
          <button
            type="button"
            className="ossmeet-table-ctrl-btn"
            onClick={onAddRow}
            title="Add row"
          >
            + Row
          </button>
          <button
            type="button"
            className="ossmeet-table-ctrl-btn"
            onClick={onAddCol}
            title="Add column"
          >
            + Col
          </button>
          {rows > 1 && (
            <button
              type="button"
              className="ossmeet-table-ctrl-btn ossmeet-table-ctrl-btn--danger"
              onClick={onRemoveRow}
              title="Remove last row"
            >
              - Row
            </button>
          )}
          {cols > 1 && (
            <button
              type="button"
              className="ossmeet-table-ctrl-btn ossmeet-table-ctrl-btn--danger"
              onClick={onRemoveCol}
              title="Remove last column"
            >
              - Col
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ─── ShapeUtil ──────────────────────────────────────────────────────────────

export class TableShapeUtil extends BaseBoxShapeUtil<TableShape> {
  static override type = TABLE_SHAPE_TYPE;
  static override props: RecordProps<TableShape> = TABLE_SHAPE_PROPS;

  override canEdit(): boolean {
    return true;
  }

  override canResize(): boolean {
    return true;
  }

  getDefaultProps(): TableShape["props"] {
    return {
      w: DEFAULT_TABLE_WIDTH,
      h: DEFAULT_TABLE_HEIGHT,
      rows: DEFAULT_TABLE_ROWS,
      cols: DEFAULT_TABLE_COLS,
      cells: makeEmptyCells(DEFAULT_TABLE_ROWS, DEFAULT_TABLE_COLS),
      headerRow: true,
    };
  }

  component(shape: TableShape) {
    const isEditing = this.editor.getEditingShapeId() === shape.id;
    const isSelected = this.editor.getSelectedShapeIds().includes(shape.id);
    const isInteractive = isEditing || isSelected;

    const updateTableProps = (props: Partial<TableShape["props"]>) => {
      this.editor.updateShape<TableShape>({
        id: shape.id,
        type: shape.type,
        props,
      });
    };

    const handleCellChange = (row: number, col: number, value: string) => {
      const newCells = shape.props.cells.map((r, ri) =>
        r.map((c, ci) => (ri === row && ci === col ? value : c))
      );
      updateTableProps({ cells: newCells });
    };

    const handleAddRow = () => {
      const { rows, cols, cells, w, h } = shape.props;
      const nextRows = clampRows(rows + 1);
      if (nextRows === rows) return;
      updateTableProps({
        rows: nextRows,
        cells: resizeCells(cells, nextRows, cols),
        ...clampTableSize(w, h + h / rows, nextRows, cols),
      });
    };

    const handleAddCol = () => {
      const { rows, cols, cells, w, h } = shape.props;
      const nextCols = clampCols(cols + 1);
      if (nextCols === cols) return;
      updateTableProps({
        cols: nextCols,
        cells: resizeCells(cells, rows, nextCols),
        ...clampTableSize(w + w / cols, h, rows, nextCols),
      });
    };

    const handleRemoveRow = () => {
      const { rows, cols, cells, w, h } = shape.props;
      if (rows <= 1) return;
      const nextRows = rows - 1;
      updateTableProps({
        rows: nextRows,
        cells: resizeCells(cells, nextRows, cols),
        ...clampTableSize(w, h - h / rows, nextRows, cols),
      });
    };

    const handleRemoveCol = () => {
      const { rows, cols, cells, w, h } = shape.props;
      if (cols <= 1) return;
      const nextCols = cols - 1;
      updateTableProps({
        cols: nextCols,
        cells: resizeCells(cells, rows, nextCols),
        ...clampTableSize(w - w / cols, h, rows, nextCols),
      });
    };

    const handleToggleHeader = () => {
      updateTableProps({ headerRow: !shape.props.headerRow });
    };

    const handleEdit = () => {
      this.editor.setEditingShape(shape.id);
    };

    return (
      <HTMLContainer
        id={shape.id}
        // Only swallow pointer events while the user is actively editing
        // cells. When the shape is merely selected we let pointer events
        // bubble so the editor can detect a double-click and enter edit
        // mode (otherwise users have to click the "Edit cells" button).
        onPointerDown={isEditing ? this.editor.markEventAsHandled : undefined}
        style={{
          pointerEvents: isInteractive ? "all" : "none",
          width: shape.props.w,
          height: shape.props.h,
        }}
      >
        <TableComponent
          shape={shape}
          isEditing={isEditing}
          showControls={isInteractive}
          onCellChange={handleCellChange}
          onAddRow={handleAddRow}
          onAddCol={handleAddCol}
          onRemoveRow={handleRemoveRow}
          onRemoveCol={handleRemoveCol}
          onToggleHeader={handleToggleHeader}
          onEdit={handleEdit}
        />
      </HTMLContainer>
    );
  }

  override getIndicatorPath(shape: TableShape) {
    const path = new Path2D();
    path.rect(0, 0, shape.props.w, shape.props.h);
    return path;
  }

  override onResize(shape: TableShape, info: TLResizeInfo<TableShape>) {
    return {
      props: {
        ...clampTableSize(
          shape.props.w * info.scaleX,
          shape.props.h * info.scaleY,
          shape.props.rows,
          shape.props.cols
        ),
      },
    };
  }
}
