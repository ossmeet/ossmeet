import { describe, expect, it } from "vitest";
import {
  buildWhiteboardAssetKey,
  extractMeetingIdFromWhiteboardUploadKey,
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

  it("extracts meeting id from upload storage key", () => {
    expect(
      extractMeetingIdFromWhiteboardUploadKey(
        "uploads/usr_1/wb/mtg_123/1710000000000-abcd-file.png"
      )
    ).toBe("mtg_123");

    expect(
      extractMeetingIdFromWhiteboardUploadKey(
        "uploads/guest-participant_1/wb/mtg_guest/1710000000000-abcd-file.png"
      )
    ).toBe("mtg_guest");

    expect(
      extractMeetingIdFromWhiteboardUploadKey(
        "uploads/usr_1/sessions/mtg_123/file.png"
      )
    ).toBeNull();
  });
});
