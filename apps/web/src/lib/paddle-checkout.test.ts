import { describe, expect, it } from "vitest";
import { buildCheckoutOpenOptions } from "./paddle-checkout";

describe("buildCheckoutOpenOptions", () => {
  it("uses an existing Paddle customer ID without sending duplicate customer details", () => {
    expect(
      buildCheckoutOpenOptions({
        priceId: "pri_123",
        customerId: "ctm_123",
      }),
    ).toEqual({
      settings: {
        displayMode: "overlay",
      },
      items: [{ priceId: "pri_123", quantity: 1 }],
      customer: { id: "ctm_123" },
    });
  });
});
