import { createLazyFileRoute } from "@tanstack/react-router";
import * as React from "react";
import {
  loadRecorderModule as loadWhiteboardRecorderModule,
  type RecorderStatus,
  type RecorderWhiteboardProps,
} from "@whiteboard/recorder";
import {
  LiveKitRoom,
  useTracks,
  VideoTrack,
  useRoomContext,
  useParticipants,
} from "@livekit/components-react";
import { ConnectionState, RoomEvent, Track, type Participant } from "livekit-client";
import type { RemoteTrackPublication } from "livekit-client";
import { Circle, Copy, Mic, MicOff, Users, Video, VideoOff } from "lucide-react";
import {
  getInitials,
  getRecorderAvatarParticipants,
  getRecorderGridColumnCount,
  isActiveRecorderVideoTrack,
  isRecorderStartupBlockedByWhiteboard,
  shouldMountRecorderWhiteboard,
  shouldWaitForRecorderWhiteboard,
  type RecorderTrackSummary,
} from "@/lib/meeting/recorder-layout";
import { parseRecorderHashParams } from "@/lib/meeting/recorder-url-params";
import { LIVEKIT_TOPICS } from "@/lib/meeting/constants";
import { parseRecorderStageMessage, type RecorderStage } from "@/lib/meeting/recorder-stage";

declare const __OSSMEET_LIVEKIT_URL__: string;
declare const __OSSMEET_WHITEBOARD_URL__: string;

export const Route = createLazyFileRoute("/recorder")({
  component: RecorderPage,
});

const WB_CONNECT_TIMEOUT_MS = 10_000;
const RECORDER_BACKGROUND = "#f5f4f2";
const TOP_BAR_BACKGROUND = "rgba(229, 226, 223, 0.96)";
const PANEL_BORDER = "rgba(214, 211, 209, 0.86)";
const TILE_BACKGROUND = "#f4f1ec";

const LazyRecorderWhiteboard = React.lazy(async () => {
  const module = await loadWhiteboardRecorderModule();
  return {
    default: module.RecorderWhiteboard as React.ComponentType<RecorderWhiteboardProps>,
  };
});

function RecorderPage() {
  const { url, token, wb_url, wb_token, meeting_code } = Route.useSearch();

  const hashParams = React.useMemo(() => {
    if (typeof window === "undefined") return new URLSearchParams();
    return parseRecorderHashParams(window.location.hash);
  }, []);
  const livekitUrl = url || hashParams.get("url") || "";
  const livekitToken = token || hashParams.get("token") || "";
  const whiteboardUrl = wb_url || hashParams.get("wb_url") || "";
  const wbToken = wb_token || hashParams.get("wb_token") || "";
  const meetingCode = meeting_code || hashParams.get("meeting_code") || "";

  React.useEffect(() => {
    if (typeof window === "undefined" || !window.location.hash.includes("wb_token=")) return;
    window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
  }, []);

  const [lkReady, setLkReady] = React.useState(false);
  const [wbStatus, setWbStatus] = React.useState<RecorderStatus>("loading");
  const [wbTimedOut, setWbTimedOut] = React.useState(false);
  const [recorderStage, setRecorderStage] = React.useState<RecorderStage>("whiteboard");
  const [started, setStarted] = React.useState(false);

  const hasWhiteboard = Boolean(whiteboardUrl && wbToken);

  // Keep the whiteboard mounted while it is the active meeting stage. The
  // startup timeout only controls when egress may start; it must not unmount
  // the board while sync is still loading, or a slow whiteboard sync can never
  // recover.
  const showWhiteboard = shouldMountRecorderWhiteboard({
    hasWhiteboard,
    stage: recorderStage,
    wbStatus,
  });
  const shouldWaitForWhiteboard = shouldWaitForRecorderWhiteboard({
    hasWhiteboard,
    stage: recorderStage,
  });
  const whiteboardStartupBlocked = isRecorderStartupBlockedByWhiteboard({
    hasWhiteboard,
    stage: recorderStage,
    wbStatus,
    wbTimedOut,
  });

  // Start 10s timeout once LiveKit is ready, waiting for whiteboard to connect
  React.useEffect(() => {
    if (!lkReady || !shouldWaitForWhiteboard || wbStatus !== "loading" || wbTimedOut) return;
    const t = setTimeout(() => setWbTimedOut(true), WB_CONNECT_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [lkReady, shouldWaitForWhiteboard, wbStatus, wbTimedOut]);

  // Fire START_RECORDING once LK is ready and whiteboard is ready-or-timed-out
  React.useEffect(() => {
    if (started) return;
    if (!lkReady) return;
    if (whiteboardStartupBlocked) return;
    setStarted(true);
    console.log("START_RECORDING");
  }, [lkReady, whiteboardStartupBlocked, started]);

  // Validate that the recorder URL matches the configured LiveKit instance.
  // The recorder route is only intended for the internal LiveKit egress bot;
  // accepting arbitrary URLs would allow the page to connect to attacker-controlled servers.
  //
  // Use import.meta.env.VITE_LIVEKIT_URL (set at build time via .dev.vars / wrangler secrets)
  // to get the authoritative configured URL. If the env var is not set, reject all URL params
  // (fail-closed) rather than allowing arbitrary connections (fail-open).
  const configuredLkUrl = __OSSMEET_LIVEKIT_URL__;
  // urlIsValid: either no url param provided, OR it matches the configured instance
  // When configuredLkUrl is empty (not configured), reject any non-empty url param
  const urlIsValid = !livekitUrl || (configuredLkUrl !== "" && livekitUrl === configuredLkUrl);
  const configuredWhiteboardUrl = __OSSMEET_WHITEBOARD_URL__;
  const wbUrlIsValid =
    !whiteboardUrl ||
    (configuredWhiteboardUrl !== "" &&
      isSameOriginUrl(whiteboardUrl, configuredWhiteboardUrl));

  if (!livekitUrl || !livekitToken || !urlIsValid || !wbUrlIsValid) {
    return <div style={{ width: "100vw", height: "100vh", background: "#111" }} />;
  }

  return (
    <LiveKitRoom
      serverUrl={livekitUrl}
      token={livekitToken}
      connect={true}
      audio={false}
      video={false}
      style={{ width: "100vw", height: "100vh", background: RECORDER_BACKGROUND, display: "flex" }}
    >
      <LkConnectionWatcher onConnected={() => setLkReady(true)} />
      <RecorderStageListener onStageChange={setRecorderStage} />
      <RecorderAudioMixer />
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          width: "100%",
          height: "100%",
          background: RECORDER_BACKGROUND,
        }}
      >
        <RecorderTopBar meetingCode={meetingCode} stage={recorderStage} />
        {showWhiteboard ? (
          <div
            style={{
              display: "flex",
              flex: 1,
              minHeight: 0,
              width: "100%",
              background: RECORDER_BACKGROUND,
            }}
          >
            <div
              style={{
                flex: 1,
                minWidth: 0,
                height: "100%",
                overflow: "hidden",
              }}
            >
              <React.Suspense fallback={null}>
                <LazyRecorderWhiteboard
                  whiteboardUrl={whiteboardUrl}
                  token={wbToken}
                  onStatusChange={setWbStatus}
                />
              </React.Suspense>
            </div>
            <RecorderParticipantsSidebar />
          </div>
        ) : (
          <div style={{ flex: 1, minHeight: 0, height: "100%", minWidth: 0 }}>
            <RecorderVideoGrid />
          </div>
        )}
      </div>
    </LiveKitRoom>
  );
}

function RecorderStageListener({ onStageChange }: { onStageChange: (stage: RecorderStage) => void }) {
  const room = useRoomContext();
  const onStageChangeRef = React.useRef(onStageChange);
  onStageChangeRef.current = onStageChange;

  React.useEffect(() => {
    const handleDataReceived = (
      payload: Uint8Array,
      _participant?: unknown,
      _kind?: unknown,
      topic?: string,
    ) => {
      if (topic !== LIVEKIT_TOPICS.RECORDER_STAGE) return;
      const message = parseRecorderStageMessage(payload);
      if (!message) return;
      onStageChangeRef.current(message.stage);
    };

    room.on(RoomEvent.DataReceived, handleDataReceived);
    return () => {
      room.off(RoomEvent.DataReceived, handleDataReceived);
    };
  }, [room]);

  return null;
}

function isSameOriginUrl(value: string, expected: string): boolean {
  try {
    return new URL(value).origin === new URL(expected).origin;
  } catch {
    return false;
  }
}

function LkConnectionWatcher({ onConnected }: { onConnected: () => void }) {
  const room = useRoomContext();
  const callbackRef = React.useRef(onConnected);
  callbackRef.current = onConnected;

  React.useEffect(() => {
    if (room.state === ConnectionState.Connected) {
      callbackRef.current();
      return;
    }
    const handler = () => callbackRef.current();
    room.on(RoomEvent.Connected, handler);
    return () => { room.off(RoomEvent.Connected, handler); };
  }, [room]);

  return null;
}

function formatDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
}

function RecorderTopBar({
  meetingCode,
  stage,
}: {
  meetingCode: string;
  stage: RecorderStage;
}) {
  const [duration, setDuration] = React.useState(0);
  const participants = useRecorderParticipants();

  React.useEffect(() => {
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      setDuration(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  const stageLabel =
    stage === "screen_share"
      ? "Screen share"
      : stage === "whiteboard"
        ? "Whiteboard"
        : "Video";

  return (
    <header
      style={{
        height: 44,
        flexShrink: 0,
        display: "flex",
        alignItems: "center",
        gap: 14,
        padding: "0 14px",
        background: TOP_BAR_BACKGROUND,
        borderBottom: `1px solid ${PANEL_BORDER}`,
        backdropFilter: "blur(20px)",
        WebkitBackdropFilter: "blur(20px)",
        color: "#44403c",
        fontFamily:
          'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 9, minWidth: 0 }}>
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: 999,
            background: "#34d399",
            boxShadow: "0 0 0 4px rgba(52, 211, 153, 0.14)",
            flexShrink: 0,
          }}
        />
        <span
          style={{
            fontFamily:
              'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
            fontSize: 13,
            fontWeight: 700,
            letterSpacing: 0.2,
            color: "#292524",
            whiteSpace: "nowrap",
          }}
        >
          {meetingCode || "ossmeet"}
        </span>
        <Copy size={14} color="#78716c" strokeWidth={2} />
        <div style={{ display: "flex", alignItems: "center", gap: 6, color: "#78716c" }}>
          <Users size={14} strokeWidth={2} />
          <span style={{ fontSize: 13, fontWeight: 600 }}>{participants.length}</span>
          <span style={{ color: "#a8a29e" }}>·</span>
          <span
            style={{
              fontFamily:
                'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
              fontSize: 13,
            }}
          >
            {formatDuration(duration)}
          </span>
        </div>
      </div>

      <div style={{ flex: 1 }} />

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 7,
          borderRadius: 999,
          background: "rgba(255,255,255,0.62)",
          border: "1px solid rgba(214,211,209,0.72)",
          padding: "5px 11px",
          color: "#57534e",
          fontSize: 13,
          fontWeight: 600,
        }}
      >
        {stage === "video" ? <Video size={15} /> : <Circle size={10} fill="#14b8a6" color="#14b8a6" />}
        {stageLabel}
      </div>
    </header>
  );
}

/** Subscribes to all microphone tracks and renders <audio> elements so the recording captures audio. */
function RecorderAudioMixer() {
  const tracks = useTracks([Track.Source.Microphone], { onlySubscribed: true });

  return (
    <>
      {tracks.map((ref) => {
        const pub = ref.publication as RemoteTrackPublication | undefined;
        if (!pub?.track) return null;
        return <AudioElement key={ref.participant.identity} track={pub.track as AudioTrack} />;
      })}
    </>
  );
}

type AudioTrack = { attach: (el?: HTMLAudioElement) => HTMLAudioElement; detach: (el?: HTMLAudioElement) => HTMLAudioElement[] };

function AudioElement({ track }: { track: AudioTrack }) {
  const ref = React.useRef<HTMLAudioElement>(null);

  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    track.attach(el);
    return () => { track.detach(el); };
  }, [track]);

  return <audio ref={ref} autoPlay playsInline style={{ display: "none" }} />;
}

type CameraTrackRef = NonNullable<Parameters<typeof VideoTrack>[0]["trackRef"]>;

function isCameraTrackRef(
  track: ReturnType<typeof useTracks>[number]
): track is CameraTrackRef {
  return track.publication !== undefined;
}

function isActiveRecorderVideoTrackRef(
  track: ReturnType<typeof useTracks>[number]
): track is CameraTrackRef {
  if (!isCameraTrackRef(track)) return false;
  return isActiveRecorderVideoTrack(toRecorderTrackSummary(track));
}

function toRecorderTrackSummary(track: CameraTrackRef): RecorderTrackSummary {
  return {
    participantIdentity: track.participant.identity,
    source: track.source === Track.Source.ScreenShare ? "screen_share" : "camera",
    isMuted: track.publication.isMuted,
  };
}

type RecorderParticipantRole = "host" | "participant" | "guest";

function getParticipantRole(participant: Participant): RecorderParticipantRole {
  try {
    const metadata = JSON.parse(participant.metadata || "{}") as { role?: unknown };
    if (metadata.role === "host") return "host";
    if (metadata.role === "guest") return "guest";
  } catch {
    // fall through to participant
  }
  return "participant";
}

function useRecorderParticipants() {
  const room = useRoomContext();
  const participants = useParticipants();

  return React.useMemo(
    () =>
      participants
        .filter((participant) => participant.identity !== room.localParticipant.identity)
        .map((participant) => ({
          identity: participant.identity,
          name: participant.name || participant.identity || "User",
          role: getParticipantRole(participant),
          isSpeaking: participant.isSpeaking,
          isMicrophoneEnabled: participant.isMicrophoneEnabled,
          isCameraEnabled: participant.isCameraEnabled,
        }))
        .sort((a, b) => {
          if (a.role === "host" && b.role !== "host") return -1;
          if (a.role !== "host" && b.role === "host") return 1;
          return a.name.localeCompare(b.name);
        }),
    [participants, room.localParticipant.identity],
  );
}

function RecorderParticipantsSidebar() {
  const participants = useRecorderParticipants();

  return (
    <aside
      style={{
        width: "clamp(260px, 16vw, 320px)",
        height: "100%",
        flexShrink: 0,
        borderLeft: `1px solid ${PANEL_BORDER}`,
        background: "rgba(255,255,255,0.86)",
        padding: 16,
        boxSizing: "border-box",
        overflowY: "auto",
        fontFamily:
          'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {participants.map((participant) => (
          <RecorderParticipantCard
            key={participant.identity}
            name={participant.name}
            role={participant.role}
            isSpeaking={participant.isSpeaking}
            isMicrophoneEnabled={participant.isMicrophoneEnabled}
            isCameraEnabled={participant.isCameraEnabled}
          />
        ))}
      </div>
    </aside>
  );
}

function RecorderParticipantCard({
  name,
  role,
  isSpeaking,
  isMicrophoneEnabled,
  isCameraEnabled,
}: {
  name: string;
  role: RecorderParticipantRole;
  isSpeaking: boolean;
  isMicrophoneEnabled: boolean;
  isCameraEnabled: boolean;
}) {
  const initials = getInitials(name);

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        minHeight: 74,
        padding: "12px 14px",
        borderRadius: 16,
        border: `1px solid ${PANEL_BORDER}`,
        background: "#ffffff",
        boxShadow: "0 12px 28px -22px rgba(41, 37, 36, 0.36)",
      }}
    >
      <div style={{ position: "relative", flexShrink: 0 }}>
        <div
          style={{
            width: 48,
            height: 48,
            borderRadius: 999,
            background: role === "host" ? "#fffbeb" : "#ccfbf1",
            color: role === "host" ? "#c2410c" : "#0f766e",
            border: "2px solid #ffffff",
            boxShadow: "0 0 0 1px rgba(214, 211, 209, 0.72)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 17,
            fontWeight: 700,
          }}
        >
          {initials}
        </div>
        {isSpeaking && isMicrophoneEnabled && (
          <span
            style={{
              position: "absolute",
              right: -1,
              bottom: -1,
              width: 12,
              height: 12,
              borderRadius: 999,
              background: "#10b981",
              border: "2px solid #ffffff",
            }}
          />
        )}
      </div>

      <div style={{ minWidth: 0, flex: 1 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 7,
            minWidth: 0,
          }}
        >
          <span
            style={{
              color: "#292524",
              fontSize: 15,
              fontWeight: 700,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {name}
          </span>
          {role === "host" && (
            <span
              style={{
                borderRadius: 6,
                border: "1px solid #fde68a",
                background: "#fffbeb",
                color: "#b45309",
                padding: "1px 5px",
                fontSize: 10,
                fontWeight: 800,
                letterSpacing: 0.2,
                textTransform: "uppercase",
              }}
            >
              Host
            </span>
          )}
        </div>
        <div style={{ marginTop: 7, display: "flex", alignItems: "center", gap: 8 }}>
          <RecorderStatusPill active={isMicrophoneEnabled} kind="mic" />
          {!isCameraEnabled && <RecorderStatusPill active={false} kind="camera" />}
        </div>
      </div>
    </div>
  );
}

function RecorderStatusPill({
  active,
  kind,
}: {
  active: boolean;
  kind: "mic" | "camera";
}) {
  const Icon =
    kind === "mic"
      ? active
        ? Mic
        : MicOff
      : active
        ? Video
        : VideoOff;
  const color = active ? "#059669" : "#a8a29e";
  const bg = active ? "#ecfdf5" : "#f5f5f4";
  const border = active ? "#a7f3d0" : "#e7e5e4";

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        borderRadius: 8,
        border: `1px solid ${border}`,
        background: bg,
        color,
        padding: "3px 6px",
        fontSize: 11,
        fontWeight: 700,
      }}
    >
      <Icon size={12} strokeWidth={2.2} />
      {kind === "mic" ? (active ? "Mic on" : "Muted") : "Camera off"}
    </span>
  );
}

/**
 * Full-canvas video layout (no whiteboard).
 * - If a screen share is active: screen share fills the main area, cameras in a sidebar rail.
 * - Otherwise: camera grid.
 */
function RecorderVideoGrid() {
  const cameraTracks = useTracks([Track.Source.Camera], { onlySubscribed: true }).filter(isActiveRecorderVideoTrackRef);
  const screenTracks = useTracks([Track.Source.ScreenShare], { onlySubscribed: true }).filter(isActiveRecorderVideoTrackRef);
  const avatarParticipants = useParticipantsWithoutVideo([...screenTracks, ...cameraTracks]);
  const hasScreenShare = screenTracks.length > 0;

  if (cameraTracks.length === 0 && screenTracks.length === 0 && avatarParticipants.length === 0) {
    return <RecorderEmptyState />;
  }

  if (hasScreenShare) {
    return (
      <div style={{ display: "flex", width: "100%", height: "100%", background: RECORDER_BACKGROUND }}>
        {/* Screen share — dominant view */}
        <div style={{ flex: 1, minWidth: 0, height: "100%", padding: "10px", boxSizing: "border-box" }}>
          <div
            style={{
              position: "relative",
              width: "100%",
              height: "100%",
              overflow: "hidden",
              borderRadius: "10px",
              background: TILE_BACKGROUND,
            }}
          >
            <VideoTrack
              trackRef={screenTracks[0]}
              style={{ width: "100%", height: "100%", objectFit: "contain" }}
            />
            <NameTag name={screenTracks[0].participant.name || screenTracks[0].participant.identity} />
          </div>
        </div>
        {/* Camera rail */}
        {(cameraTracks.length > 0 || avatarParticipants.length > 0) && (
          <div
            style={{
              width: "clamp(180px, 16vw, 280px)",
              height: "100%",
              flexShrink: 0,
              borderLeft: "1px solid rgba(120, 113, 108, 0.18)",
              background: "rgba(255,255,255,0.86)",
            }}
          >
            <RecorderVideoRailList tracks={cameraTracks} avatarParticipants={avatarParticipants} />
          </div>
        )}
      </div>
    );
  }

  const totalTiles = cameraTracks.length + avatarParticipants.length;
  const cols = getRecorderGridColumnCount(totalTiles);
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
        alignContent: "start",
        gap: "10px",
        padding: "10px",
        width: "100%",
        height: "100%",
        background: RECORDER_BACKGROUND,
        overflowY: "auto",
        boxSizing: "border-box",
      }}
    >
      {cameraTracks.map((track) => (
        <RecorderVideoTile
          key={track.publication?.trackSid ?? track.participant.identity}
          track={track}
        />
      ))}
      {avatarParticipants.map((participant) => (
        <RecorderAvatarTile key={participant.identity} participant={participant} />
      ))}
    </div>
  );
}

function RecorderVideoRailList({
  tracks,
  avatarParticipants = [],
}: {
  tracks: CameraTrackRef[];
  avatarParticipants?: Participant[];
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "10px",
        padding: "10px",
        width: "100%",
        height: "100%",
        boxSizing: "border-box",
        overflowY: "auto",
      }}
    >
      {tracks.map((track) => (
        <RecorderVideoTile
          key={track.publication?.trackSid ?? track.participant.identity}
          track={track}
        />
      ))}
      {avatarParticipants.map((participant) => (
        <RecorderAvatarTile key={participant.identity} participant={participant} />
      ))}
    </div>
  );
}

function useParticipantsWithoutVideo(videoTracks: CameraTrackRef[]) {
  const room = useRoomContext();
  const participants = useParticipants();
  const activeVideoTracks = React.useMemo(
    () => videoTracks.map(toRecorderTrackSummary),
    [videoTracks]
  );
  const avatarIdentities = React.useMemo(
    () =>
      new Set(
        getRecorderAvatarParticipants({
          participants: participants.map((participant) => ({
            identity: participant.identity,
            name: participant.name,
          })),
          activeVideoTracks,
          localParticipantIdentity: room.localParticipant.identity,
        }).map((participant) => participant.identity),
      ),
    [activeVideoTracks, participants, room.localParticipant.identity],
  );

  return React.useMemo(
    () =>
      participants
        .filter((participant) => avatarIdentities.has(participant.identity))
        .sort((a, b) => (a.name || a.identity).localeCompare(b.name || b.identity)),
    [participants, avatarIdentities]
  );
}

function RecorderVideoTile({ track }: { track: CameraTrackRef }) {
  const participantName = track.participant.name || track.participant.identity;

  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        aspectRatio: "16 / 9",
        overflow: "hidden",
        borderRadius: "10px",
        background: TILE_BACKGROUND,
        boxShadow: "0 6px 24px rgba(28, 25, 23, 0.10)",
      }}
    >
      <VideoTrack
        trackRef={track}
        style={{ width: "100%", height: "100%", objectFit: "cover" }}
      />
      <NameTag name={participantName} />
    </div>
  );
}

function RecorderAvatarTile({ participant }: { participant: Participant }) {
  const participantName = participant.name || participant.identity;
  const initials = getInitials(participantName);

  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        aspectRatio: "16 / 9",
        overflow: "hidden",
        borderRadius: "10px",
        background: TILE_BACKGROUND,
        boxShadow: "0 6px 24px rgba(28, 25, 23, 0.10)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div
        style={{
          width: "52px",
          height: "52px",
          borderRadius: "999px",
          background: "#ccfbf1",
          color: "#0f766e",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: "22px",
          fontWeight: 700,
          boxShadow: "0 0 0 3px rgba(255,255,255,0.7)",
        }}
      >
        {initials}
      </div>
      <NameTag name={participantName} />
    </div>
  );
}

function NameTag({ name }: { name: string }) {
  return (
    <div
      style={{
        position: "absolute",
        left: "8px",
        bottom: "8px",
        maxWidth: "calc(100% - 16px)",
        background: "rgba(28, 25, 23, 0.68)",
        color: "#fafaf9",
        borderRadius: "6px",
        padding: "4px 8px",
        fontSize: "12px",
        lineHeight: 1.2,
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
      }}
    >
      {name}
    </div>
  );
}

function RecorderEmptyState() {
  return (
    <div
      style={{
        display: "flex",
        width: "100%",
        height: "100%",
        alignItems: "center",
        justifyContent: "center",
        color: "#78716c",
        fontSize: "14px",
        background: RECORDER_BACKGROUND,
      }}
    >
      Waiting for camera video...
    </div>
  );
}
