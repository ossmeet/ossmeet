import { defaultShapeUtils } from "tldraw";
import { CustomFrameShapeUtil } from "./custom-frame-shape-util";
import { TableShapeUtil } from "./table-shape-util";

export const whiteboardShapeUtils = [CustomFrameShapeUtil, TableShapeUtil];

export const whiteboardSyncShapeUtils = [TableShapeUtil, ...defaultShapeUtils];
