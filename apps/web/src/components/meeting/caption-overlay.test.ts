import { describe, expect, it } from "vitest";
import type { CaptionLine } from "@/lib/meeting/use-livekit-captions";
import { getVisibleCaptionLines } from "./caption-overlay";

function line(overrides: Partial<CaptionLine>): CaptionLine {
  return {
    userId: "user_1",
    userName: "User 1",
    text: "hello",
    isFinal: false,
    updatedAt: 1,
    ...overrides,
  };
}

describe("caption overlay selection", () => {
  it("keeps only the latest line per speaker", () => {
    const visible = getVisibleCaptionLines([
      line({ userId: "alice", userName: "Alice", text: "old", updatedAt: 5 }),
      line({ userId: "alice", userName: "Alice", text: "new", updatedAt: 30 }),
      line({ userId: "bob", userName: "Bob", text: "middle", updatedAt: 20 }),
    ]);

    expect(visible.map((entry) => entry.text)).toEqual(["middle", "new"]);
  });

  it("ignores empty text", () => {
    const visible = getVisibleCaptionLines([
      line({ userId: "u", text: "" }),
      line({ userId: "v", text: "real" }),
    ]);
    expect(visible.map((entry) => entry.text)).toEqual(["real"]);
  });

  it("caps the result at the requested max", () => {
    const visible = getVisibleCaptionLines(
      [
        line({ userId: "a", text: "a", updatedAt: 1 }),
        line({ userId: "b", text: "b", updatedAt: 2 }),
        line({ userId: "c", text: "c", updatedAt: 3 }),
        line({ userId: "d", text: "d", updatedAt: 4 }),
      ],
      2,
    );
    expect(visible.map((entry) => entry.text)).toEqual(["c", "d"]);
  });
});
