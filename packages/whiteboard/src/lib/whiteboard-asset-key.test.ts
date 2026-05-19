import { describe, expect, it } from "vitest";
import {
  addWhiteboardAssetTokenToViewerUrl,
  buildWhiteboardAssetApiPath,
  buildWhiteboardAssetKey,
  buildWhiteboardAssetViewerUrl,
  extractMeetingIdFromWhiteboardUploadKey,
  extractWhiteboardAssetKeyFromViewerUrl,
  isValidWhiteboardAssetKeyForMeeting,
  whiteboardAssetPrefix,
} from "./whiteboard-asset-key";

describe("whiteboard asset key helpers", () => {
  it("builds and validates wb keys per meeting", () => {
    const key = buildWhiteboardAssetKey("mtg_123", "1710000000000-abcd-file.png");
    expect(key).toBe("wb/mtg_123/1710000000000-abcd-file.png");
    expect(whiteboardAssetPrefix("mtg_123")).toBe("wb/mtg_123/");
    expect(isValidWhiteboardAssetKeyForMeeting(key, "mtg_123")).toBe(true);
    expect(isValidWhiteboardAssetKeyForMeeting(key, "mtg_other")).toBe(false);
  });

  it("builds whiteboard asset viewer URLs", () => {
    expect(
      buildWhiteboardAssetApiPath("uploads/usr_1/wb/mtg_123/1710000000000-abcd-file.png"),
    ).toBe("/api/wb-assets/uploads/usr_1/wb/mtg_123/1710000000000-abcd-file.png");

    expect(
      buildWhiteboardAssetViewerUrl("uploads/usr_1/wb/mtg_123/1710000000000-abcd-file.png"),
    ).toBe("/api/wb-assets/uploads/usr_1/wb/mtg_123/1710000000000-abcd-file.png");

    expect(
      buildWhiteboardAssetViewerUrl("/api/wb-assets/uploads/usr_1/wb/mtg_123/file.png"),
    ).toBe("/api/wb-assets/uploads/usr_1/wb/mtg_123/file.png");

    expect(buildWhiteboardAssetViewerUrl("https://example.com/file.png")).toBe(
      "https://example.com/file.png",
    );
  });

  it("adds recorder asset tokens only to whiteboard asset URLs", () => {
    expect(
      addWhiteboardAssetTokenToViewerUrl(
        "/api/wb-assets/uploads/usr_1/wb/mtg_123/file.png",
        "recorder-token",
      ),
    ).toBe("/api/wb-assets/uploads/usr_1/wb/mtg_123/file.png?wbToken=recorder-token");

    expect(
      addWhiteboardAssetTokenToViewerUrl(
        "/api/wb-assets/uploads/usr_1/wb/mtg_123/file.png?foo=bar",
        "recorder-token",
      ),
    ).toBe("/api/wb-assets/uploads/usr_1/wb/mtg_123/file.png?foo=bar&wbToken=recorder-token");

    expect(addWhiteboardAssetTokenToViewerUrl("https://example.com/file.png", "recorder-token")).toBe(
      "https://example.com/file.png",
    );
  });

  it("extracts meeting id from upload storage key", () => {
    expect(
      extractMeetingIdFromWhiteboardUploadKey(
        "uploads/usr_1/wb/mtg_123/1710000000000-abcd-file.png",
      ),
    ).toBe("mtg_123");

    expect(
      extractMeetingIdFromWhiteboardUploadKey(
        "uploads/guest-participant_1/wb/mtg_guest/1710000000000-abcd-file.png",
      ),
    ).toBe("mtg_guest");

    expect(
      extractMeetingIdFromWhiteboardUploadKey("uploads/usr_1/sessions/mtg_123/file.png"),
    ).toBeNull();
  });

  it("extracts storage keys from viewer URLs", () => {
    expect(
      extractWhiteboardAssetKeyFromViewerUrl(
        "/api/wb-assets/uploads/usr_1/wb/mtg_123/file%20name.png?wbToken=abc",
      ),
    ).toBe("uploads/usr_1/wb/mtg_123/file name.png");

    expect(
      extractWhiteboardAssetKeyFromViewerUrl(
        "https://ossmeet.com/api/wb-assets/uploads/usr_1/wb/mtg_123/file.png",
      ),
    ).toBe("uploads/usr_1/wb/mtg_123/file.png");

    expect(extractWhiteboardAssetKeyFromViewerUrl("https://example.com/file.png")).toBeNull();
    expect(extractWhiteboardAssetKeyFromViewerUrl("/api/wb-assets/uploads/usr_1/../secret")).toBeNull();
  });
});
