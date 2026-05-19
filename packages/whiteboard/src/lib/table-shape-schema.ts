import { T } from "@tldraw/validate";

export const TABLE_SHAPE_TYPE = "table" as const;
export const DEFAULT_TABLE_ROWS = 3;
export const DEFAULT_TABLE_COLS = 3;
export const DEFAULT_TABLE_WIDTH = 360;
export const DEFAULT_TABLE_HEIGHT = 200;
export const MIN_TABLE_COL_WIDTH = 40;
export const MIN_TABLE_ROW_HEIGHT = 24;
export const MAX_TABLE_ROWS = 30;
export const MAX_TABLE_COLS = 30;
export const MAX_TABLE_CELL_CHARS = 500;
export const MAX_TABLE_CELLS = MAX_TABLE_ROWS * MAX_TABLE_COLS;

const boundedPositiveNumber = (label: string, max: number) =>
  T.number.check(label, (value) => {
    if (!Number.isFinite(value) || value <= 0 || value > max) {
      throw new Error(`Expected ${label} to be in range 1..${max}`);
    }
  });

const boundedPositiveInteger = (label: string, max: number) =>
  T.number.check(label, (value) => {
    if (!Number.isInteger(value) || value < 1 || value > max) {
      throw new Error(`Expected ${label} to be an integer in range 1..${max}`);
    }
  });

const boundedCellText = T.string.check("table cell text", (value) => {
  if (value.length > MAX_TABLE_CELL_CHARS) {
    throw new Error(`Expected table cell text to be at most ${MAX_TABLE_CELL_CHARS} characters`);
  }
});

const boundedCells = T.arrayOf(T.arrayOf(boundedCellText)).check("table cells", (rows) => {
  if (rows.length > MAX_TABLE_ROWS) {
    throw new Error(`Expected at most ${MAX_TABLE_ROWS} table rows`);
  }
  let cellCount = 0;
  for (const row of rows) {
    if (row.length > MAX_TABLE_COLS) {
      throw new Error(`Expected at most ${MAX_TABLE_COLS} table columns`);
    }
    cellCount += row.length;
  }
  if (cellCount > MAX_TABLE_CELLS) {
    throw new Error(`Expected at most ${MAX_TABLE_CELLS} table cells`);
  }
});

export const TABLE_SHAPE_PROPS = {
  w: boundedPositiveNumber("table width", 20_000),
  h: boundedPositiveNumber("table height", 20_000),
  rows: boundedPositiveInteger("table rows", MAX_TABLE_ROWS),
  cols: boundedPositiveInteger("table columns", MAX_TABLE_COLS),
  cells: boundedCells,
  headerRow: T.boolean,
};
