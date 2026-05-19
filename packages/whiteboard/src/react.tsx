/**
 * Whiteboard React components
 * Exports wrapped tldraw components for use in client apps.
 */

import { useCallback } from "react";
import {
  Tldraw,
  type TLAssetStore,
  type TLAnyBindingUtilConstructor,
  type TLRecord,
  type TLStoreSnapshot,
  type TLAnyShapeUtilConstructor,
  type TLUserStore,
} from "tldraw";
import { useSync } from "@tldraw/sync";

export { Tldraw, useSync };
export type { TLAssetStore };

/**
 * Pre-configured asset store that doesn't upload.
 * Useful for read-only or ephemeral whiteboards.
 *
 * `upload` returns an empty src intentionally — images dropped onto a
 * read-only whiteboard are silently discarded rather than uploaded.
 */
export const NoopAssetStore: TLAssetStore = {
  upload: async (_asset, _file, _abortSignal) => ({ src: "" }),
  resolve: (asset, _ctx) => asset.props.src ?? null,
};

/**
 * Sync store hook options
 */
export interface UseWhiteboardSyncOptions {
  uri: string | (() => string | Promise<string>);
  assets?: TLAssetStore;
  shapeUtils?: readonly TLAnyShapeUtilConstructor[];
  bindingUtils?: readonly TLAnyBindingUtilConstructor[];
  users?: TLUserStore;
  onCustomMessageReceived?: (data: unknown) => void;
}

/**
 * Hook to connect to the whiteboard server.
 * Wraps @tldraw/sync's useSync with our server protocol.
 */
export function useWhiteboardSync(options: UseWhiteboardSyncOptions) {
  // When users isn't available yet (async dynamic imports haven't resolved),
  // use a URI function that never resolves. This prevents useSync from opening
  // a WebSocket before the user identity is known. Without this, useSync would
  // open a connection with users=undefined, then immediately tear it down when
  // users becomes available (producing "WebSocket is closed before the
  // connection is established" errors). By blocking the URI, the first
  // connection attempt never opens; when users arrives both uri and users
  // change together and useSync creates a single clean connection.
  const pendingUri = useCallback(
    () => new Promise<string>(() => {}),
    []
  );

  return useSync({
    uri: (options.users
      ? options.uri
      : pendingUri) as string | (() => string | Promise<string>),
    assets: options.assets ?? NoopAssetStore,
    shapeUtils: options.shapeUtils,
    bindingUtils: options.bindingUtils,
    users: options.users,
    onCustomMessageReceived: options.onCustomMessageReceived,
  });
}

/**
 * Props for the WhiteboardCanvas component.
 */
export interface WhiteboardCanvasProps {
  store: ReturnType<typeof useSync>["store"];
  className?: string;
  assetUrls?: Record<string, unknown>;
}

/**
 * Main whiteboard canvas component.
 * Renders the collaborative drawing surface.
 */
export function WhiteboardCanvas({ store, className, assetUrls }: WhiteboardCanvasProps) {
  return <Tldraw store={store} className={className} assetUrls={assetUrls as any} />;
}

/**
 * Full meeting whiteboard with pages, custom toolbar, status bar,
 * GoodNotes-style laser, stroke eraser, and page shadows.
 */
export { buildWhiteboardPdfBlob } from "./lib/export-pdf";
export { MeetingWhiteboard } from "./components/meeting-whiteboard";
export type {
  MeetingWhiteboardHandle,
  MeetingWhiteboardProps,
  UploadFileFn,
  ExportSnapshotFn,
} from "./components/meeting-whiteboard";

export { RecorderWhiteboard } from "./components/recorder-whiteboard";
export type { RecorderWhiteboardProps } from "./components/recorder-whiteboard";
export type { Editor, TLShapeId } from "tldraw";

// ─── Snapshot conversion ──────────────────────────────────────────────────────
// Converts a TLSyncRoom snapshot (what the whiteboard server pushes to R2)
// into the TLStoreSnapshot format that <Tldraw> / editor.store.loadSnapshot()
// accepts. The schema is recreated from the same defaults used by the server.

import { createTLSchema, defaultShapeSchemas } from "@tldraw/tlschema";
import { TABLE_SHAPE_PROPS, TABLE_SHAPE_TYPE } from "./lib/table-shape-schema";

const _clientSchema = createTLSchema({
  shapes: {
    ...defaultShapeSchemas,
    [TABLE_SHAPE_TYPE]: {
      props: TABLE_SHAPE_PROPS,
      migrations: { sequence: [] },
    },
  },
});

export interface RoomSnapshotDocument {
  state: Record<string, unknown>;
  lastChangedClock?: number; // sync-internal field; not used for snapshot conversion
}

export function roomSnapshotToStoreSnapshot(roomSnapshot: {
  documents: RoomSnapshotDocument[];
}): TLStoreSnapshot {
  return {
    schema: _clientSchema.serialize(),
    store: Object.fromEntries(
      roomSnapshot.documents.map((d) => [d.state.id as string, d.state])
    ) as unknown as TLStoreSnapshot["store"] & Record<string, TLRecord>,
  };
}
