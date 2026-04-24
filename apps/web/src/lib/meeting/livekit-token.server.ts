import { AccessToken, TrackSource } from "livekit-server-sdk";

/** Token TTL for self-hosted LiveKit deployments.
 *  Short TTLs are critical because self-hosted does not invalidate
 *  tokens when a participant is removed from a room. */
export const TOKEN_TTL = "10m";

export interface CreateTokenParams {
  apiKey: string;
  apiSecret: string;
  identity: string;
  name: string;
  roomName: string;
  isHost: boolean;
  metadata: Record<string, unknown>;
  canPublishSources?: TrackSource[];
  ttl?: string;
}

export interface LiveKitAccessResult {
  token: string;
  // Embedded LiveKit TURN/STUN credentials are advertised by the LiveKit server
  // during signaling. Keep this field for the client response shape; it is only
  // populated if OSSMeet later adds an external ICE override.
  turnServers: Array<{
    urls: string[];
    username: string;
    credential: string;
  }>;
  expiresIn: number;
}

/**
 * Create a LiveKit access token with role-based grants.
 * Host gets screen share; participants do not.
 */
export async function createLiveKitToken({
  apiKey,
  apiSecret,
  identity,
  name,
  roomName,
  isHost,
  metadata,
  canPublishSources,
  ttl = TOKEN_TTL,
}: CreateTokenParams): Promise<string> {
  const at = new AccessToken(apiKey, apiSecret, {
    identity,
    name,
    ttl,
    metadata: JSON.stringify(metadata),
  });

  at.addGrant({
    roomJoin: true,
    room: roomName,
    canPublish: true,
    canPublishData: true,
    canSubscribe: true,
    canUpdateOwnMetadata: false,
    roomAdmin: isHost,
    canPublishSources:
      canPublishSources ??
      (isHost
        ? [
            TrackSource.CAMERA,
            TrackSource.MICROPHONE,
            TrackSource.SCREEN_SHARE,
            TrackSource.SCREEN_SHARE_AUDIO,
          ]
        : [TrackSource.CAMERA, TrackSource.MICROPHONE]),
  });

  return at.toJwt();
}

function parseTtlToSeconds(ttl: string): number {
  const match = ttl.match(/^(\d+)(h|m|s)$/);
  if (!match) return 10 * 60; // safety default matches TOKEN_TTL
  const value = Number(match[1]);
  switch (match[2]) {
    case "h": return value * 60 * 60;
    case "m": return value * 60;
    case "s": return value;
    default: return 10 * 60;
  }
}

export async function createLiveKitAccess(params: CreateTokenParams): Promise<LiveKitAccessResult> {
  const token = await createLiveKitToken(params);

  return {
    token,
    turnServers: [],
    expiresIn: parseTtlToSeconds(params.ttl ?? TOKEN_TTL),
  };
}
