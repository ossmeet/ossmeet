import { createTLSchema, defaultShapeSchemas } from "@tldraw/tlschema";
import { TABLE_SHAPE_PROPS, TABLE_SHAPE_TYPE } from "./lib/table-shape-schema";

export const defaultTLSchema = createTLSchema({
  shapes: {
    ...defaultShapeSchemas,
    [TABLE_SHAPE_TYPE]: {
      props: TABLE_SHAPE_PROPS,
      migrations: { sequence: [] },
    },
  },
});
