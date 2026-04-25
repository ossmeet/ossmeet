import { describe, expect, it } from "vitest";
import { verifyPaddleWebhookSignature } from "./paddle";

async function signPayload(body: string, secret: string, timestampSeconds: number) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(`${timestampSeconds}:${body}`));
  const hex = Array.from(new Uint8Array(signature))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `ts=${timestampSeconds};h1=${hex}`;
}

describe("verifyPaddleWebhookSignature", () => {
  it("accepts a valid recent signature", async () => {
    const body = JSON.stringify({ event_type: "subscription.updated" });
    const secret = "test_secret";
    const timestampSeconds = Math.floor(Date.now() / 1000);
    const header = await signPayload(body, secret, timestampSeconds);

    await expect(verifyPaddleWebhookSignature(body, header, secret)).resolves.toBe(true);
  });

  it("rejects stale signatures even when the HMAC is valid", async () => {
    const body = JSON.stringify({ event_type: "subscription.updated" });
    const secret = "test_secret";
    const timestampSeconds = Math.floor(Date.now() / 1000) - 301;
    const header = await signPayload(body, secret, timestampSeconds);

    await expect(verifyPaddleWebhookSignature(body, header, secret)).resolves.toBe(false);
  });

  it("rejects malformed signature headers", async () => {
    const body = JSON.stringify({ event_type: "subscription.updated" });

    await expect(
      verifyPaddleWebhookSignature(body, "ts=not-a-number;h1=xyz", "test_secret"),
    ).resolves.toBe(false);
  });
});
