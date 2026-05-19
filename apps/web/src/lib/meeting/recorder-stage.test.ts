import { describe, expect, it } from "vitest";
import { parseRecorderStageMessage } from "./recorder-stage";

const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));

describe("parseRecorderStageMessage", () => {
  it("parses whiteboard stage messages", () => {
    expect(
      parseRecorderStageMessage(
        encode({ type: "recorder.stage", stage: "whiteboard", timestamp: 123 }),
      ),
    ).toEqual({ type: "recorder.stage", stage: "whiteboard", timestamp: 123 });
  });

  it("parses video stage messages", () => {
    expect(
      parseRecorderStageMessage(
        encode({ type: "recorder.stage", stage: "video", timestamp: 456 }),
      ),
    ).toEqual({ type: "recorder.stage", stage: "video", timestamp: 456 });
  });

  it("parses screen share stage messages", () => {
    expect(
      parseRecorderStageMessage(
        encode({ type: "recorder.stage", stage: "screen_share", timestamp: 789 }),
      ),
    ).toEqual({ type: "recorder.stage", stage: "screen_share", timestamp: 789 });
  });

  it("rejects unrelated or invalid messages", () => {
    expect(parseRecorderStageMessage(encode({ type: "reaction", stage: "video" }))).toBeNull();
    expect(parseRecorderStageMessage(encode({ type: "recorder.stage", stage: "bad" }))).toBeNull();
    expect(parseRecorderStageMessage(new Uint8Array([1, 2, 3]))).toBeNull();
  });
});
