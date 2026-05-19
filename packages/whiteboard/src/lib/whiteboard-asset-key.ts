const WHITEBOARD_PREFIX = "wb";
const WHITEBOARD_ASSET_API_PREFIX = "/api/wb-assets/";

export function whiteboardAssetPrefix(meetingId: string): string {
  return `${WHITEBOARD_PREFIX}/${meetingId}/`;
}

export function buildWhiteboardAssetKey(meetingId: string, filename: string): string {
  return `${whiteboardAssetPrefix(meetingId)}${filename}`;
}

export function buildWhiteboardAssetApiPath(r2Key: string): string {
  const normalizedKey = r2Key.replace(/^\/+/, "");
  return `${WHITEBOARD_ASSET_API_PREFIX}${normalizedKey}`;
}

export function buildWhiteboardAssetViewerUrl(
  src: string,
  _connectionId?: string | null,
): string {
  if (
    src.startsWith("http://") ||
    src.startsWith("https://") ||
    src.startsWith("blob:") ||
    src.startsWith("data:")
  ) {
    return src;
  }

  if (src.startsWith("/")) {
    return src;
  }

  return buildWhiteboardAssetApiPath(src);
}

export function addWhiteboardAssetTokenToViewerUrl(src: string, token: string | null | undefined): string {
  if (!token) return src;
  if (!src.startsWith(WHITEBOARD_ASSET_API_PREFIX)) return src;

  const [path, query = ""] = src.split("?");
  const params = new URLSearchParams(query);
  params.set("wbToken", token);
  const nextQuery = params.toString();
  return nextQuery ? `${path}?${nextQuery}` : path;
}

export function extractWhiteboardAssetKeyFromViewerUrl(src: string): string | null {
  let pathname = "";

  if (src.startsWith(WHITEBOARD_ASSET_API_PREFIX)) {
    pathname = src;
  } else if (src.startsWith("http://") || src.startsWith("https://")) {
    try {
      pathname = new URL(src).pathname;
    } catch {
      return null;
    }
  } else {
    return null;
  }

  const pathOnly = pathname.split("?")[0] ?? "";
  if (!pathOnly.startsWith(WHITEBOARD_ASSET_API_PREFIX)) return null;
  const encodedKey = pathOnly.slice(WHITEBOARD_ASSET_API_PREFIX.length);
  if (!encodedKey || encodedKey.includes("..")) return null;

  try {
    const key = decodeURIComponent(encodedKey);
    if (!key || key.includes("..")) return null;
    return key;
  } catch {
    return null;
  }
}

export function isValidWhiteboardAssetKeyForMeeting(r2Key: string, meetingId: string): boolean {
  return r2Key.startsWith(whiteboardAssetPrefix(meetingId));
}

export function extractMeetingIdFromWhiteboardUploadKey(key: string): string | null {
  const match = key.match(/^uploads\/[^/]+\/wb\/([^/]+)\//);
  return match?.[1] ?? null;
}
