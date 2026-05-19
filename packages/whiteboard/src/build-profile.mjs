import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const _addonPath = fileURLToPath(new URL("./addons.mjs", import.meta.url));
const _addon = existsSync(_addonPath)
  ? await import(`${pathToFileURL(_addonPath).href}?t=${Date.now()}`)
  : {};

const _webRuntimeModule = fileURLToPath(new URL("./web/whiteboard-runtime.ts", import.meta.url));
const _webDashboardModule = fileURLToPath(new URL("./web/whiteboard-dashboard.tsx", import.meta.url));
const _webRecorderModule = fileURLToPath(new URL("./web/whiteboard-recorder.tsx", import.meta.url));

/** @type {RegExp} Matches whiteboard vendor module paths in node_modules */
const VENDOR_RE = /\/node_modules\/(tldraw|@tldraw[/+]|pdf-lib)/;

export function isWhiteboardVendor(id) {
  return VENDOR_RE.test(id);
}

export function classifyChunk(id) {
  if (!id.includes("node_modules")) return undefined;

  if (_addon.classifyChunk) {
    const addonChunk = _addon.classifyChunk(id);
    if (addonChunk !== undefined) return addonChunk;
  }

  if (
    id.includes("/node_modules/pdf-lib/") ||
    id.includes("/node_modules/@pdf-lib/")
  )
    return "vendor-surface-document";

  if (
    id.includes("/node_modules/react-markdown") ||
    id.includes("/node_modules/remark") ||
    id.includes("/node_modules/rehype") ||
    id.includes("/node_modules/unified") ||
    id.includes("/node_modules/micromark") ||
    id.includes("/node_modules/mdast") ||
    id.includes("/node_modules/vfile") ||
    id.includes("/node_modules/unist") ||
    id.includes("/node_modules/hast-") ||
    id.includes("/node_modules/@types/hast") ||
    id.includes("/node_modules/lowlight") ||
    id.includes("/node_modules/highlight") ||
    id.includes("/node_modules/character-entities") ||
    id.includes("/node_modules/property-information") ||
    id.includes("/node_modules/web-namespaces") ||
    id.includes("/node_modules/zwitch") ||
    id.includes("/node_modules/trim-lines") ||
    id.includes("/node_modules/decode-named-character-reference") ||
    id.includes("/node_modules/ccount") ||
    id.includes("/node_modules/escape-string-regexp") ||
    id.includes("/node_modules/comma-separated-tokens") ||
    id.includes("/node_modules/space-separated-tokens") ||
    id.includes("/node_modules/longest-streak") ||
    id.includes("/node_modules/extend") ||
    id.includes("/node_modules/develop") ||
    id.includes("/node_modules/bail") ||
    id.includes("/node_modules/trough") ||
    id.includes("/node_modules/devlop") ||
    id.includes("/node_modules/@speed-highlight/") ||
    id.includes("/node_modules/katex/") ||
    id.includes("/node_modules/marked") ||
    id.includes("/node_modules/dompurify")
  )
    return "vendor-surface-text";

  if (
    id.includes("/node_modules/@use-gesture/") ||
    id.includes("/node_modules/rbush/") ||
    id.includes("/node_modules/lz-string/") ||
    id.includes("/node_modules/hotkeys-js/") ||
    id.includes("/node_modules/linkify") ||
    id.includes("/node_modules/eventemitter3") ||
    id.includes("/node_modules/@radix-ui/") ||
    id.includes("/node_modules/roughjs") ||
    id.includes("/node_modules/rough-") ||
    id.includes("/node_modules/upng") ||
    id.includes("/node_modules/@aspect-build/") ||
    id.includes("/node_modules/fractional-indexing") ||
    id.includes("/node_modules/jittered-fractional-indexing") ||
    id.includes("/node_modules/w3c-keyname") ||
    id.includes("/node_modules/idb-keyval") ||
    id.includes("/node_modules/css-tree") ||
    id.includes("/node_modules/@css-tree/") ||
    id.includes("/node_modules/bidi-js") ||
    id.includes("/node_modules/mltd") ||
    id.includes("/node_modules/emmetio") ||
    id.includes("/node_modules/emmet") ||
    id.includes("/node_modules/classnames") ||
    id.includes("/node_modules/lodash.") ||
    id.includes("/node_modules/lodash/")
  )
    return "vendor-surface-core";

  return undefined;
}

export const additionalSsrStubs = {
  modules: [
    "@whiteboard/runtime",
    _webRuntimeModule,
    "@whiteboard/dashboard",
    _webDashboardModule,
    "@whiteboard/recorder",
    _webRecorderModule,
    "@whiteboard/use-audio-cancellation",
    "tldraw",
    /^@tldraw\//,
    "pdf-lib",
    ...(_addon.ssrStubs?.modules ?? []),
  ],
  exports: {
    "@whiteboard/runtime": [
      "MeetingRoomContent",
      "preloadWhiteboard",
    ],
    [_webRuntimeModule]: [
      "MeetingRoomContent",
      "preloadWhiteboard",
    ],
    "@whiteboard/use-audio-cancellation": ["useAudioCancellation"],
    "@whiteboard/dashboard": [
      "MeetingRecapPdfPanel",
      "RecentMeetingsPdfCell",
    ],
    [_webDashboardModule]: [
      "MeetingRecapPdfPanel",
      "RecentMeetingsPdfCell",
    ],
    "@whiteboard/recorder": [
      "loadRecorderModule",
    ],
    [_webRecorderModule]: [
      "loadRecorderModule",
    ],
    "tldraw": [
      "AssetRecordType",
      "BaseBoxShapeTool",
      "BaseBoxShapeUtil",
      "Box",
      "CollaboratorScribbleOverlayUtil",
      "DefaultColorStyle",
      "DefaultDashStyle",
      "DefaultFillStyle",
      "DefaultSizeStyle",
      "FileHelpers",
      "FrameShapeUtil",
      "GeoShapeGeoStyle",
      "HTMLContainer",
      "RecordProps",
      "SVGContainer",
      "ScribbleOverlayUtil",
      "StateNode",
      "Tldraw",
      "atom",
      "createShapeId",
      "defaultHandleExternalUrlContent",
      "defaultShapeUtils",
      "getHashForString",
      "getStroke",
      "tipTapDefaultExtensions",
      "track",
      "useActions",
      "useCanRedo",
      "useCanUndo",
      "useEditor",
      "useToasts",
      "useValue",
    ],
    "@tldraw/state": ["computed"],
    "@tldraw/sync": ["useSync"],
    "@tldraw/tlschema": [
      "createShapeId",
      "createTLSchema",
      "createUserId",
      "defaultShapeSchemas",
      "UserRecordType",
    ],
    "@tldraw/validate": ["T"],
    ...(_addon.ssrStubs?.exports ?? {}),
  },
};

export const resolveAliases = [
  ...(_addon.viteAliases ?? []),
  {
    find: "@whiteboard/use-audio-cancellation",
    replacement: fileURLToPath(new URL("./web/use-audio-cancellation.ts", import.meta.url)),
  },
];

export const webRuntimeModule = _webRuntimeModule;
export const webApiModule = fileURLToPath(new URL("./web/api-handler.ts", import.meta.url));
export const webDashboardModule = _webDashboardModule;
export const webRecorderModule = _webRecorderModule;
export const webStylesModule = fileURLToPath(new URL("./web/whiteboard-styles.css", import.meta.url));
export const webServerModule = fileURLToPath(new URL("./web/whiteboard-server.ts", import.meta.url));
