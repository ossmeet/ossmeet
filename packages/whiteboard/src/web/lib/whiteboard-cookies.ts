import { createCookieString, appendCookies, getCookieValue } from "@/server/auth/helpers";

type CookieOptions = { appUrl?: string; environment?: string };

const WHITEBOARD_ASSET_COOKIE_MAX_AGE = 60 * 60; // 1 hour — aligned with the default WB JWT lifetime

export function whiteboardAssetCookieName(meetingId: string): string {
  return `ossmeet_wb_asset_${meetingId}`;
}

export function getWhiteboardAssetTokenFromCookie(
  cookie: string | null,
  meetingId: string,
): string | null {
  return getCookieValue(cookie, whiteboardAssetCookieName(meetingId));
}

export function setWhiteboardAssetCookie(
  meetingId: string,
  token: string,
  options?: CookieOptions
): void {
  try {
    const cookieStr = createCookieString(
      whiteboardAssetCookieName(meetingId),
      token,
      WHITEBOARD_ASSET_COOKIE_MAX_AGE,
      { ...options, path: "/api/wb-assets/" }
    );
    appendCookies([cookieStr]);
  } catch {
    // Direct unit tests may call token issuance helpers without a response context.
  }
}

export function clearWhiteboardAssetCookie(
  meetingId: string,
  options?: CookieOptions
): void {
  try {
    const cookieStr = createCookieString(
      whiteboardAssetCookieName(meetingId),
      "",
      0,
      { ...options, path: "/api/wb-assets/" }
    );
    appendCookies([cookieStr]);
  } catch {
  }
}
