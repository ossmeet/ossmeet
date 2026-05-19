import { describe, expect, it } from "vitest";
import {
  getServerErrorCode,
  getServerErrorStatusCode,
  isServerError,
} from "./errors";

describe("server error helpers", () => {
  it("reads top-level server error metadata", () => {
    const error = Object.assign(new Error("boom"), {
      code: "MEETING_NOT_STARTED",
      statusCode: 404,
    });

    expect(getServerErrorCode(error)).toBe("MEETING_NOT_STARTED");
    expect(getServerErrorStatusCode(error)).toBe(404);
    expect(isServerError(error)).toBe(true);
  });

  it("reads nested server error metadata from wrapped errors", () => {
    const error = {
      data: {
        error: {
          cause: {
            code: "MEETING_NOT_STARTED",
            statusCode: 404,
          },
        },
      },
    };

    expect(getServerErrorCode(error)).toBe("MEETING_NOT_STARTED");
    expect(getServerErrorStatusCode(error)).toBe(404);
  });

  it("returns undefined for non-server errors", () => {
    expect(getServerErrorCode(new Error("network"))).toBeUndefined();
    expect(getServerErrorStatusCode({})).toBeUndefined();
    expect(isServerError(new Error("network"))).toBe(false);
  });
});
