import { afterEach, describe, expect, it, vi } from "vitest";
import { checkWhiteboardCanvasEditAccess } from "./whiteboard-canvas-access-check";

const baseEnv = {
  WHITEBOARD_URL: "https://whiteboard-a.example",
  WHITEBOARD_URLS: "https://whiteboard-b.example/",
  WHITEBOARD_INTERNAL_SECRET: "secret",
} as Env & { WHITEBOARD_URLS: string };

describe("checkWhiteboardCanvasEditAccess", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("normalizes meeting ids and sends the internal secret", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ canEditCanvas: true }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await checkWhiteboardCanvasEditAccess(baseEnv, {
      sessionId: "mtg_123",
      userId: "participant_1",
      role: "participant",
    });

    expect(result).toEqual({ canEditCanvas: true });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://whiteboard-a.example/access/check",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "Content-Type": "application/json",
          "X-Whiteboard-Secret": "secret",
        }),
        body: JSON.stringify({
          sessionId: "meet-mtg_123",
          userId: "participant_1",
          role: "participant",
        }),
      }),
    );
  });

  it("does not fall back to alternate whiteboard urls for stateful access checks", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("unavailable", { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      checkWhiteboardCanvasEditAccess(baseEnv, {
        sessionId: "meet-mtg_123",
        userId: "participant_1",
        role: "participant",
      }),
    ).resolves.toEqual({
      canEditCanvas: false,
      status: 503,
      message: "Whiteboard service unavailable",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns forbidden when the whiteboard denies edit access", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ canWrite: false })));

    await expect(
      checkWhiteboardCanvasEditAccess(baseEnv, {
        sessionId: "meet-mtg_123",
        userId: "participant_1",
        role: "participant",
      }),
    ).resolves.toEqual({
      canEditCanvas: false,
      status: 403,
      message: "Whiteboard edit access is required",
    });
  });
});
