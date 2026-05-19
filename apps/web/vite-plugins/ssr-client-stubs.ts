import type { Plugin } from "vite";

/**
 * SSR Client Stubs Plugin
 *
 * Replaces heavy client-only libraries with empty stubs during the SSR build.
 * These modules need DOM/WebRTC APIs that don't exist in Cloudflare Workers and
 * would otherwise bloat the Worker bundle.
 *
 * Client builds are intentionally left alone. TanStack Start should own the
 * server-function/client boundary instead of masking server-package imports with
 * synthetic `undefined` exports.
 */

const STUBBED_MODULES: (string | RegExp)[] = [
  "livekit-client",
  "@livekit/components-react",
  "@livekit/components-styles",
  "@livekit/track-processors",
  "@simplewebauthn/browser",
  "@base-ui/react",
];

const KNOWN_STUB_EXPORTS: Record<string, string[]> = {
  "livekit-client": [
    "AudioPresets", "ConnectionState", "VideoPresets", "RoomEvent", "Room",
    "LocalTrack", "RemoteParticipant", "Track",
    "createLocalAudioTrack", "createLocalVideoTrack",
    "createLocalTracks", "DataPacket_Kind",
    "VideoTrack", "AudioTrack",
    "RemoteTrackPublication", "LocalTrackPublication",
    "ParticipantEvent", "TrackEvent",
    "ReconnectPolicy", "ConnectionQuality",
    "RoomConnectOptions", "RoomOptions",
    "DisconnectReason",
  ],
  "@livekit/components-react": [
    "LiveKitRoom", "RoomAudioRenderer", "VideoConference",
    "useMaybeRoomContext", "useLocalParticipant",
    "useTracks", "useParticipants", "useRoomContext",
    "useConnectionState",
    "GridLayout", "ParticipantTile", "TrackMutedIndicator",
    "ConnectionState", "FocusLayout", "FocusLayoutContainer",
    "Chat", "ChatEntry", "ChatToggle",
    "ParticipantName", "TrackRefContext",
    "VideoTrack", "isTrackReference",
    "ObservableRoom", "RoomContext",
  ],
  "@livekit/track-processors": [
    "BackgroundProcessor",
    "supportsBackgroundProcessors",
    "supportsModernBackgroundProcessors",
  ],
  "@simplewebauthn/browser": [
    "browserSupportsWebAuthn",
    "browserSupportsWebAuthnAutofill",
    "startAuthentication",
    "startRegistration",
  ],
};

export interface AdditionalSsrStubs {
  modules: (string | RegExp)[];
  exports: Record<string, string[]>;
}

function createBaseUiStubCode(): string {
  return `
const Passthrough = ({ children }) => children ?? null;
const createNamespace = () => new Proxy(Passthrough, {
  get(target, prop) {
    if (prop in target) return target[prop];
    return Passthrough;
  },
});

export const Avatar = createNamespace();
export const Checkbox = createNamespace();
export const Dialog = createNamespace();
export const Drawer = createNamespace();
export const Field = createNamespace();
export const Popover = createNamespace();
export const Progress = createNamespace();
export const Select = createNamespace();
export const Separator = createNamespace();
export const Slider = createNamespace();
export const Switch = createNamespace();
export const Button = Passthrough;
export const Menu = createNamespace();
export const Tabs = createNamespace();
export const Tooltip = createNamespace();
export const Toast = new Proxy(Passthrough, {
  get(target, prop) {
    if (prop in target) return target[prop];
    if (prop === "useToastManager") {
      return () => ({
        toasts: [],
        add() {},
        close() {},
        remove() {},
        update() {},
      });
    }
    return Passthrough;
  },
});

export default {};
`;
}

function matchesStubbedModule(source: string, allStubbed: (string | RegExp)[]): boolean {
  for (const pattern of allStubbed) {
    if (typeof pattern === "string") {
      if (source === pattern || source.startsWith(pattern + "/")) return true;
    } else {
      if (pattern.test(source)) return true;
    }
  }
  return false;
}

export function ssrClientStubs(options?: { additional?: AdditionalSsrStubs }): Plugin {
  const allStubbed = [...STUBBED_MODULES, ...(options?.additional?.modules ?? [])];
  const allExports = { ...KNOWN_STUB_EXPORTS, ...(options?.additional?.exports ?? {}) };

  const STUB_ID = "virtual:ssr-client-stub";
  const RESOLVED_STUB_ID = "\0" + STUB_ID;

  return {
    name: "ssr-client-stubs",
    enforce: "pre",

    resolveId(source) {
      if (
        source[0] === "." ||
        source[0] === "\0" ||
        source.startsWith("virtual:") ||
        source.startsWith("node:")
      ) {
        return null;
      }

      if (this.environment.config.consumer !== "server") return null;
      if (!matchesStubbedModule(source, allStubbed)) return null;

      return { id: `${RESOLVED_STUB_ID}?source=${encodeURIComponent(source)}`, syntheticNamedExports: true };
    },

    load(id) {
      if (!id.startsWith(RESOLVED_STUB_ID)) return null;

      const sourceParam = id.split("source=")[1];
      const source = sourceParam ? decodeURIComponent(sourceParam) : "";

      if (source === "@base-ui/react" || source.startsWith("@base-ui/react/")) {
        return { code: createBaseUiStubCode() };
      }

      const exports = allExports[source] ?? [];
      const namedExports = exports.map((e) => `export const ${e} = undefined;`).join("\n");

      return {
        code: `export default {};\n${namedExports}`,
      };
    },
  };
}
