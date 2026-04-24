import type { Plugin } from "vite";

/**
 * SSR Client Stubs Plugin
 *
 * Two-way stubbing strategy:
 *
 * 1. SSR stubs (STUBBED_MODULES): Replaces heavy client-only libraries with empty stubs
 *    during the SSR build. These need DOM APIs that don't exist in Cloudflare Workers.
 *    Without stubbing, they inflate the Worker bundle (~5.7MB of useless code).
 *
 * 2. Client stubs (SERVER_ONLY_MODULES): Replaces server-only libraries with empty stubs
 *    during the client build. These use Node APIs (node:crypto etc.) that can't run in
 *    the browser. TanStack Start strips server function bodies from client bundles but
 *    top-level imports remain — stubbing them eliminates the dead code and the warning.
 *
 * The plugin accepts additional stubs via options so that private packages (e.g. whiteboard)
 * can register their own vendor stubs without modifying this file.
 */

const SERVER_ONLY_MODULES: string[] = [
  "livekit-server-sdk",
  "drizzle-orm",
  "@ossmeet/db",
  "@simplewebauthn/server",
  "ai",
  "@ai-sdk/google",
  "@ai-sdk/openai",
];

const STUBBED_MODULES: (string | RegExp)[] = [
  "livekit-client",
  "@livekit/components-react",
  "@livekit/components-styles",
  "@livekit/track-processors",
];

const KNOWN_STUB_EXPORTS: Record<string, string[]> = {
  "livekit-server-sdk": [
    "AccessToken", "RoomServiceClient", "EgressClient",
    "TrackSource", "EncodedFileOutput", "EncodedFileType",
  ],
  "drizzle-orm": [
    "eq", "and", "or", "lt", "gt", "gte", "lte", "ne",
    "isNull", "isNotNull", "inArray", "notInArray",
    "asc", "desc", "count", "sql", "like", "ilike",
    "exists", "not",
  ],
  "drizzle-orm/d1": ["drizzle"],
  "drizzle-orm/sqlite-core": [
    "sqliteTable", "text", "integer", "real", "blob",
    "sqliteView", "sqliteIndex",
  ],
  "@ossmeet/db": ["createDb"],
  "@ossmeet/db/schema": [
    "users", "sessions", "accounts", "verifications",
    "passkeys", "devices",
    "spaces", "spaceMembers", "spaceInvites",
    "rooms", "meetingSessions", "meetingParticipants", "transcripts",
    "meetingSummaries", "meetingArtifacts", "spaceAssets",
    "usersRelations", "sessionsRelations", "accountsRelations",
    "passkeysRelations", "devicesRelations", "spacesRelations",
    "spaceMembersRelations", "spaceInvitesRelations",
    "roomsRelations", "meetingSessionsRelations",
    "transcriptsRelations", "meetingSummariesRelations",
    "meetingParticipantsRelations", "meetingArtifactsRelations",
    "spaceAssetsRelations",
  ],
  "@simplewebauthn/server": [
    "generateAuthenticationOptions",
    "generateRegistrationOptions",
    "verifyAuthenticationResponse",
    "verifyRegistrationResponse",
  ],
  "@simplewebauthn/server/helpers": ["isoBase64URL"],
  "ai": [
    "streamText", "generateText", "generateObject", "streamObject",
    "tool", "embed", "embedMany",
  ],
  "@ai-sdk/google": ["createGoogleGenerativeAI", "google"],
  "@ai-sdk/openai": ["createOpenAI", "openai"],
  "livekit-client": [
    "ConnectionState", "VideoPresets", "RoomEvent", "Room",
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
};

export interface AdditionalSsrStubs {
  modules: (string | RegExp)[];
  exports: Record<string, string[]>;
}

function buildHintRe(modules: (string | RegExp)[]): RegExp {
  const literals = modules.filter((m): m is string => typeof m === "string");
  if (literals.length === 0) return /(?!)/;
  const escaped = literals.map((m) => m.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(`^(?:${escaped.join("|")})(?:\\/|$)`);
}

const SERVER_ONLY_HINT_RE = buildHintRe(SERVER_ONLY_MODULES);

function matchesServerOnlyModule(source: string): boolean {
  return SERVER_ONLY_MODULES.some(
    (m) => source === m || source.startsWith(m + "/")
  );
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
  const stubbedHintRe = buildHintRe(allStubbed);

  const STUB_ID = "virtual:ssr-client-stub";
  const RESOLVED_STUB_ID = "\0" + STUB_ID;

  return {
    name: "ssr-client-stubs",
    enforce: "pre",

    resolveId(source, _importer, options) {
      if (
        source[0] === "." ||
        source[0] === "\0" ||
        source.startsWith("virtual:") ||
        source.startsWith("node:")
      ) {
        return null;
      }

      const isSSR = !!options?.ssr;
      if (isSSR) {
        if (!stubbedHintRe.test(source) && !allStubbed.some((p) => typeof p !== "string" && p.test(source))) return null;
        if (!matchesStubbedModule(source, allStubbed)) return null;
      } else {
        if (!SERVER_ONLY_HINT_RE.test(source) || !matchesServerOnlyModule(source)) {
          return null;
        }
      }

      return { id: `${RESOLVED_STUB_ID}?source=${encodeURIComponent(source)}`, syntheticNamedExports: true };
    },

    load(id) {
      if (!id.startsWith(RESOLVED_STUB_ID)) return null;

      const sourceParam = id.split("source=")[1];
      const source = sourceParam ? decodeURIComponent(sourceParam) : "";

      const exports = allExports[source] ?? [];
      const namedExports = exports.map((e) => `export const ${e} = undefined;`).join("\n");

      return {
        code: `export default {};\n${namedExports}`,
        syntheticNamedExports: true,
      };
    },
  };
}
