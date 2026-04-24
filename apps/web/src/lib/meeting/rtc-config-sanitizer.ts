import { logWarn } from "@/lib/logger-client";

type IceServerLike = RTCIceServer;
type RtcConfigLike = RTCConfiguration | undefined;

function isValidIceUrl(url: string): boolean {
  const match = /^(stun|stuns|turn|turns):([^?]+)(\?.*)?$/i.exec(url.trim());
  if (!match) return false;

  const authority = match[2]?.trim();
  if (!authority) return false;
  if (authority.includes("{") || authority.includes("}") || authority.includes(" ")) {
    return false;
  }

  if (authority.startsWith("[")) {
    return /^\[[0-9a-f:.]+\](?::\d+)?$/i.test(authority);
  }

  const host = authority.includes(":")
    ? authority.slice(0, authority.lastIndexOf(":"))
    : authority;

  return /^[a-z0-9.-]+$/i.test(host);
}

function sanitizeIceServers(iceServers: IceServerLike[] | undefined): IceServerLike[] | undefined {
  if (!iceServers) return undefined;

  const sanitized = iceServers
    .map((server) => {
      const urls = Array.isArray(server.urls) ? server.urls : [server.urls];
      const validUrls = urls.filter((url): url is string => typeof url === "string" && isValidIceUrl(url));

      if (validUrls.length === 0) {
        const invalidUrls = urls.filter((url) => typeof url === "string");
        if (invalidUrls.length > 0) {
          logWarn("[Meeting] Dropping invalid ICE server URLs", invalidUrls);
        }
        return null;
      }

      if (validUrls.length !== urls.length) {
        const invalidUrls = urls.filter((url) => typeof url === "string" && !isValidIceUrl(url));
        logWarn("[Meeting] Filtered invalid ICE server URLs", invalidUrls);
      }

      return {
        ...server,
        urls: Array.isArray(server.urls) ? validUrls : validUrls[0],
      } satisfies RTCIceServer;
    })
    .filter((server): server is IceServerLike => server !== null);

  return sanitized;
}

export function sanitizeRtcConfiguration(
  rtcConfig: RtcConfigLike,
): RTCConfiguration | undefined {
  if (!rtcConfig?.iceServers) return rtcConfig;
  return {
    ...rtcConfig,
    iceServers: sanitizeIceServers(rtcConfig.iceServers),
  };
}

let installed = false;

export function installRtcConfigurationSanitizer(): void {
  if (installed || typeof window === "undefined" || typeof RTCPeerConnection === "undefined") {
    return;
  }

  const Original = window.RTCPeerConnection;

  class SanitizedRTCPeerConnection extends Original {
    constructor(configuration?: RTCConfiguration) {
      super(sanitizeRtcConfiguration(configuration));
    }

    override setConfiguration(configuration?: RTCConfiguration): void {
      return super.setConfiguration(sanitizeRtcConfiguration(configuration));
    }
  }

  Object.setPrototypeOf(SanitizedRTCPeerConnection, Original);
  window.RTCPeerConnection = SanitizedRTCPeerConnection as typeof RTCPeerConnection;
  installed = true;
}
