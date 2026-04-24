import { describe, expect, it } from "vitest";

function buildRecorderUrl(appUrl: string, whiteboardUrl: string, wbToken: string): string {
  const search = new URLSearchParams({ wb_url: whiteboardUrl });
  const hash = new URLSearchParams({ wb_token: wbToken });
  return `${appUrl}/recorder?${search.toString()}#${hash.toString()}`;
}

describe("recorder URL token placement", () => {
  it("keeps whiteboard token in URL fragment", () => {
    const url = buildRecorderUrl(
      "https://app.ossmeet.com",
      "https://whiteboard.ossmeet.com",
      "secret-token"
    );
    const parsed = new URL(url);
    expect(parsed.searchParams.get("wb_url")).toBe("https://whiteboard.ossmeet.com");
    expect(parsed.searchParams.get("wb_token")).toBeNull();
    expect(parsed.hash).toBe("#wb_token=secret-token");
  });
});
