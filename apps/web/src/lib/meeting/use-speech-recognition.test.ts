import { describe, expect, it } from "vitest";
import {
  extractSpeechRecognitionResults,
} from "./use-speech-recognition";
import type { SpeechRecognitionEvent } from "./speech-recognition-support";

function recognitionEvent(
  results: Array<{ transcript: string; isFinal: boolean }>,
  resultIndex = 0,
): SpeechRecognitionEvent {
  return {
    resultIndex,
    results: results.map((result) => ({
      0: { transcript: result.transcript },
      isFinal: result.isFinal,
    })),
  } as unknown as SpeechRecognitionEvent;
}

describe("extractSpeechRecognitionResults", () => {
  it("extracts every changed result from resultIndex onward", () => {
    const event = recognitionEvent(
      [
        { transcript: "already handled", isFinal: true },
        { transcript: "first final", isFinal: true },
        { transcript: "live interim", isFinal: false },
      ],
      1,
    );

    expect(extractSpeechRecognitionResults(event)).toEqual([
      { text: "first final", isFinal: true },
      { text: "live interim", isFinal: false },
    ]);
  });

  it("trims and ignores empty transcripts", () => {
    const event = recognitionEvent([
      { transcript: "   ", isFinal: false },
      { transcript: "  useful text  ", isFinal: true },
    ]);

    expect(extractSpeechRecognitionResults(event)).toEqual([
      { text: "useful text", isFinal: true },
    ]);
  });
});
