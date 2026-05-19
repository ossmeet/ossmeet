import { describe, expect, it } from "vitest";
import { summarizeProviderErrorBody } from "./email";

describe("summarizeProviderErrorBody", () => {
  it("keeps only safe provider fields from JSON responses", () => {
    const summary = summarizeProviderErrorBody(JSON.stringify({
      name: "validation_error",
      code: "invalid_from_address",
      message: "contains recipient@example.com",
    }));

    expect(summary).toBe("name=validation_error code=invalid_from_address");
  });

  it("omits plain text bodies", () => {
    expect(summarizeProviderErrorBody("raw provider body")).toBe("[response body omitted]");
  });
});
