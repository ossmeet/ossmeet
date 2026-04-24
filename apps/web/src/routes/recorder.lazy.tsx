import { createLazyFileRoute } from "@tanstack/react-router";
import * as React from "react";
import {
  LiveKitRoom,
  useTracks,
  VideoTrack,
  useRoomContext,
} from "@livekit/components-react";
import { ConnectionState, RoomEvent, Track } from "livekit-client";
import type { RemoteTrackPublication } from "livekit-client";
import { RecorderWhiteboard } from "@/lib/whiteboard/client-runtime";
import "@/lib/whiteboard/client-runtime.css";

export const Route = createLazyFileRoute("/recorder")({
  component: RecorderPage,
});

const WB_CONNECT_TIMEOUT_MS = 10_000;
const RECORDER_BACKGROUND = "#050816";
const SIDEBAR_BACKGROUND = "#0b1220";
const TILE_BACKGROUND = "#1f2937";

function RecorderPage() {
  const { url, token, wb_url, wb_token } = Route.useSearch() as {
    url?: string;
    token?: string;
    wb_url?: string;
    wb_token?: string;
  };

  const hashParams = React.useMemo(() => {
    if (typeof window === "undefined") return new URLSearchParams();
    const hash = window.location.hash.startsWith("#")
      ? window.location.hash.slice(1)
      : window.location.hash;
    return new URLSearchParams(hash);
  }, []);
  const wbToken = typeof wb_token === "string" ? wb_token : hashParams.get("wb_token") ?? "";

  const [lkReady, setLkReady] = React.useState(false);
  const [wbStatus, setWbStatus] = React.useState<"loading" | "ready" | "error">("loading");
  const [wbTimedOut, setWbTimedOut] = React.useState(false);
  const [started, setStarted] = React.useState(false);

  const hasWhiteboard = Boolean(wb_url && wbToken);

  // Show whiteboard once it is ready, regardless of whether the timeout already
  // fired. This ensures that a slow cold-start doesn't permanently drop the
  // board: recording starts after the timeout, but the board appears as soon
  // as it connects — even if that's a few seconds into the recording.
  const showWhiteboard = hasWhiteboard && (wbStatus === "ready" || !wbTimedOut);

  // Start 10s timeout once LiveKit is ready, waiting for whiteboard to connect
  React.useEffect(() => {
    if (!lkReady || !hasWhiteboard || wbStatus === "ready" || wbTimedOut) return;
    const t = setTimeout(() => setWbTimedOut(true), WB_CONNECT_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [lkReady, hasWhiteboard, wbStatus, wbTimedOut]);

  // Fire START_RECORDING once LK is ready and whiteboard is ready-or-timed-out
  React.useEffect(() => {
    if (started) return;
    if (!lkReady) return;
    if (hasWhiteboard && wbStatus !== "ready" && !wbTimedOut) return;
    setStarted(true);
    console.log("START_RECORDING");
  }, [lkReady, hasWhiteboard, wbStatus, wbTimedOut, started]);

  // Validate that the recorder URL matches the configured LiveKit instance.
  // The recorder route is only intended for the internal LiveKit egress bot;
  // accepting arbitrary URLs would allow the page to connect to attacker-controlled servers.
  //
  // Use import.meta.env.VITE_LIVEKIT_URL (set at build time via .dev.vars / wrangler secrets)
  // to get the authoritative configured URL. If the env var is not set, reject all URL params
  // (fail-closed) rather than allowing arbitrary connections (fail-open).
  const configuredLkUrl: string = (import.meta.env as Record<string, string>).VITE_LIVEKIT_URL ?? "";
  // urlIsValid: either no url param provided, OR it matches the configured instance
  // When configuredLkUrl is empty (not configured), reject any non-empty url param
  const urlIsValid = !url || (configuredLkUrl !== "" && url === configuredLkUrl);

  if (!url || !token || !urlIsValid) {
    return <div style={{ width: "100vw", height: "100vh", background: "#111" }} />;
  }

  return (
    <LiveKitRoom
      serverUrl={url}
      token={token}
      connect={true}
      audio={false}
      video={false}
      style={{ width: "100vw", height: "100vh", background: RECORDER_BACKGROUND, display: "flex" }}
    >
      <LkConnectionWatcher onConnected={() => setLkReady(true)} />
      <RecorderAudioMixer />
      <div
        style={{
          display: "flex",
          width: "100%",
          height: "100%",
          background: RECORDER_BACKGROUND,
        }}
      >
        {showWhiteboard ? (
          <>
            <div
              style={{
                flex: 1,
                minWidth: 0,
                height: "100%",
                overflow: "hidden",
              }}
            >
              <RecorderWhiteboard
                whiteboardUrl={wb_url!}
                token={wbToken}
                onStatusChange={setWbStatus}
              />
            </div>
            {/* When whiteboard is active, all video tracks (cameras + screen shares) go in the rail */}
            <div
              style={{
                width: "clamp(220px, 18vw, 320px)",
                height: "100%",
                flexShrink: 0,
                borderLeft: "1px solid rgba(255, 255, 255, 0.08)",
                background: SIDEBAR_BACKGROUND,
              }}
            >
              <RecorderVideoRail />
            </div>
          </>
        ) : (
          <div style={{ flex: 1, height: "100%", minWidth: 0 }}>
            <RecorderVideoGrid />
          </div>
        )}
      </div>
    </LiveKitRoom>
  );
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

/**
 * Full-canvas video layout (no whiteboard).
 * - If a screen share is active: screen share fills the main area, cameras in a sidebar rail.
 * - Otherwise: camera grid.
 */
function RecorderVideoGrid() {
  const cameraTracks = useTracks([Track.Source.Camera], { onlySubscribed: true }).filter(isCameraTrackRef);
  const screenTracks = useTracks([Track.Source.ScreenShare], { onlySubscribed: true }).filter(isCameraTrackRef);
  const hasScreenShare = screenTracks.length > 0;

  if (cameraTracks.length === 0 && screenTracks.length === 0) {
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
        {cameraTracks.length > 0 && (
          <div
            style={{
              width: "clamp(180px, 16vw, 280px)",
              height: "100%",
              flexShrink: 0,
              borderLeft: "1px solid rgba(255, 255, 255, 0.08)",
              background: SIDEBAR_BACKGROUND,
            }}
          >
            <RecorderVideoRailList tracks={cameraTracks} />
          </div>
        )}
      </div>
    );
  }

  const cols = cameraTracks.length <= 1 ? 1 : cameraTracks.length <= 4 ? 2 : 3;
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
    </div>
  );
}

/**
 * Video rail shown alongside the whiteboard.
 * Includes both camera tracks and screen share tracks so screen shares
 * are visible in the recording even when the whiteboard is active.
 */
function RecorderVideoRail() {
  const cameraTracks = useTracks([Track.Source.Camera], { onlySubscribed: true }).filter(isCameraTrackRef);
  const screenTracks = useTracks([Track.Source.ScreenShare], { onlySubscribed: true }).filter(isCameraTrackRef);
  // Screen shares first so they're visually prominent at the top of the rail
  const allTracks = [...screenTracks, ...cameraTracks];

  if (allTracks.length === 0) {
    return <RecorderEmptyState />;
  }

  return <RecorderVideoRailList tracks={allTracks} />;
}

function RecorderVideoRailList({ tracks }: { tracks: CameraTrackRef[] }) {
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
    </div>
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

function NameTag({ name }: { name: string }) {
  return (
    <div
      style={{
        position: "absolute",
        left: "8px",
        bottom: "8px",
        maxWidth: "calc(100% - 16px)",
        background: "rgba(0, 0, 0, 0.55)",
        color: "#f8fafc",
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
        color: "#94a3b8",
        fontSize: "14px",
        background: RECORDER_BACKGROUND,
      }}
    >
      Waiting for camera video...
    </div>
  );
}
