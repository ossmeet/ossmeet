import { describe, expect, it } from "vitest";
import { buildRecorderUrl } from "../recorder-url";

describe("recorder URL token placement", () => {
  it("keeps recorder parameters in the fragment", () => {
    const url = buildRecorderUrl(
      "https://app.ossmeet.com",
      "https://whiteboard.ossmeet.com",
      "secret-token",
      { meetingCode: "abc-defg-hij" },
    );
    const parsed = new URL(url);
    const hash = new URLSearchParams(parsed.hash.slice(1));

    expect(parsed.search).toBe("");
    expect(hash.get("wb_url")).toBe("https://whiteboard.ossmeet.com");
    expect(hash.get("wb_token")).toBe("secret-token");
    expect(hash.get("meeting_code")).toBe("abc-defg-hij");
  });

  it("keeps whiteboard params parseable if egress appends recorder params after the fragment", () => {
    const url = `${buildRecorderUrl(
      "https://app.ossmeet.com",
      "https://whiteboard.ossmeet.com",
      "secret-token"
    )}?url=wss%3A%2F%2Flivekit.ossmeet.com&token=livekit-token`;
    const parsed = new URL(url);
    const normalizedHash = parsed.hash.slice(1).replace("?", "&");
    const hash = new URLSearchParams(normalizedHash);

    expect(parsed.search).toBe("");
    expect(hash.get("wb_url")).toBe("https://whiteboard.ossmeet.com");
    expect(hash.get("wb_token")).toBe("secret-token");
    expect(hash.get("url")).toBe("wss://livekit.ossmeet.com");
    expect(hash.get("token")).toBe("livekit-token");
  });
});
