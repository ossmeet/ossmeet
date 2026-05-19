import { beforeEach, describe, expect, it, vi } from "vitest";

const lookupMock = vi.fn();

vi.mock("node:dns/promises", () => ({
  lookup: lookupMock,
}));

describe("whiteboard security helpers", () => {
  beforeEach(() => {
    lookupMock.mockReset();
  });

  it("classifies broadcast audiences by message type", async () => {
    const { classifyBroadcastAudience, getBroadcastMessageType } = await import("./security");

    expect(getBroadcastMessageType({ type: "wiki.search" })).toBe("wiki.search");
    expect(getBroadcastMessageType({ type: 123 })).toBeNull();
    expect(classifyBroadcastAudience("page.sync")).toBeNull();
    expect(classifyBroadcastAudience("assistant.panel.open")).toBe("canvas-edit");
    expect(classifyBroadcastAudience("assistant.panel.close")).toBe("canvas-edit");
    expect(classifyBroadcastAudience("assistant.chat.user")).toBe("participant");
    expect(classifyBroadcastAudience("assistant.chat.assistant")).toBe("participant");
    expect(classifyBroadcastAudience("assistant.chat.streaming")).toBe("participant");
    expect(classifyBroadcastAudience("assistant.chat.clear")).toBe("whiteboard-manager");
    expect(classifyBroadcastAudience("wiki.dismiss")).toBe("participant");
    expect(classifyBroadcastAudience("writer.approved")).toBe("server-only");
    expect(classifyBroadcastAudience("unknown")).toBeNull();
  });

  it("rejects suspicious hostnames before DNS resolution", async () => {
    const { assertSafeUnfurlTarget, UnsafeUnfurlTargetError } = await import("./security");

    await expect(assertSafeUnfurlTarget(new URL("http://localhost:8080/path"))).rejects.toEqual(
      expect.objectContaining({
        name: UnsafeUnfurlTargetError.name,
        message: "Hostname is not allowed",
      })
    );
    expect(lookupMock).not.toHaveBeenCalled();
  });

  it("rejects hostnames that resolve to private addresses", async () => {
    lookupMock.mockResolvedValue([{ address: "10.0.0.8", family: 4 }]);

    const { assertSafeUnfurlTarget, UnsafeUnfurlTargetError } = await import("./security");

    await expect(assertSafeUnfurlTarget(new URL("https://private.example"))).rejects.toEqual(
      expect.objectContaining({
        name: UnsafeUnfurlTargetError.name,
        message: "Resolved address is not public",
      })
    );
  });

  it("allows public hostnames that resolve to public addresses", async () => {
    lookupMock.mockResolvedValue([
      { address: "93.184.216.34", family: 4 },
      { address: "2606:2800:220:1:248:1893:25c8:1946", family: 6 },
    ]);

    const { assertSafeUnfurlTarget } = await import("./security");

    // C5: now returns resolved IPs for DNS pinning
    const result = await assertSafeUnfurlTarget(new URL("https://example.com"));
    expect(result).toEqual(["93.184.216.34", "2606:2800:220:1:248:1893:25c8:1946"]);
  });

  it("validates broadcast payload shapes", async () => {
    const { validateBroadcastPayload } = await import("./security");

    // Valid assistant.chat.user
    expect(
      validateBroadcastPayload("assistant.chat.user", {
        type: "assistant.chat.user",
        message: { id: "abc", role: "user", content: "hello" },
      })
    ).toBe(true);

    // Missing required fields
    expect(
      validateBroadcastPayload("assistant.chat.user", {
        type: "assistant.chat.user",
      })
    ).toBe(false);

    expect(
      validateBroadcastPayload("assistant.chat.assistant", {
        type: "assistant.chat.assistant",
        message: { id: "abc", role: "user", content: "hello" },
      })
    ).toBe(false);

    // Unknown type returns false (not in any allowed-type set)
    expect(validateBroadcastPayload("unknown.type", { type: "unknown.type" })).toBe(false);

    expect(
      validateBroadcastPayload("wiki.result", {
        type: "wiki.result",
        query: "Pythagorean theorem",
        article: { title: "Pythagorean theorem", url: "https://en.wikipedia.org/wiki/Pythagorean_theorem" },
        searcherName: "Alice",
      })
    ).toBe(true);

    expect(
      validateBroadcastPayload("wiki.result", {
        type: "wiki.result",
        query: "Pythagorean theorem",
        result: { title: "Pythagorean theorem" },
      })
    ).toBe(false);
  });

  it("matches trusted proxy exact IPs and Docker bridge CIDRs", async () => {
    const { isTrustedProxyIp, parseTrustedProxyList } = await import("./security");

    const trusted = parseTrustedProxyList("127.0.0.1,172.16.0.0/12");

    expect(isTrustedProxyIp("127.0.0.1", trusted)).toBe(true);
    expect(isTrustedProxyIp("172.19.0.4", trusted)).toBe(true);
    expect(isTrustedProxyIp("::ffff:172.19.0.4", trusted)).toBe(true);
    expect(isTrustedProxyIp("192.168.1.10", trusted)).toBe(false);
  });

  it("ignores malformed trusted proxy entries", async () => {
    const { isTrustedProxyIp, parseTrustedProxyList } = await import("./security");

    const trusted = parseTrustedProxyList("bad-cidr,172.19.0.4/40,10.0.0.1");

    expect(isTrustedProxyIp("10.0.0.1", trusted)).toBe(true);
    expect(isTrustedProxyIp("172.19.0.4", trusted)).toBe(false);
  });

  it("rejects loopback IPv4 addresses", async () => {
    lookupMock.mockResolvedValue([{ address: "127.0.0.1", family: 4 }]);

    const { assertSafeUnfurlTarget, UnsafeUnfurlTargetError } = await import("./security");

    await expect(assertSafeUnfurlTarget(new URL("https://loopback.example"))).rejects.toEqual(
      expect.objectContaining({ name: UnsafeUnfurlTargetError.name })
    );
  });

  it("rejects link-local addresses", async () => {
    lookupMock.mockResolvedValue([{ address: "169.254.169.254", family: 4 }]);

    const { assertSafeUnfurlTarget, UnsafeUnfurlTargetError } = await import("./security");

    await expect(assertSafeUnfurlTarget(new URL("https://metadata.example"))).rejects.toEqual(
      expect.objectContaining({ name: UnsafeUnfurlTargetError.name })
    );
  });
});
