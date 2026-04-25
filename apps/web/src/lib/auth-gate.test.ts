import { describe, expect, it } from "vitest";
import { isRedirect } from "@tanstack/react-router";
import { resolveSessionGate } from "./auth-gate";

function makeContext(overrides: {
  fetchQuery?: () => Promise<unknown>;
  getQueryData?: () => unknown;
}) {
  return {
    queryClient: {
      fetchQuery: overrides.fetchQuery ?? (() => Promise.resolve(null)),
      getQueryData: overrides.getQueryData ?? (() => undefined),
    },
  } as any;
}

const location = { pathname: "/dashboard", searchStr: "?tab=recent" };

describe("resolveSessionGate", () => {
  it("redirects to auth when the session resolves to null", async () => {
    await expect(resolveSessionGate(makeContext({}), location)).rejects.toSatisfy((error: unknown) => {
      expect(isRedirect(error)).toBe(true);
      return true;
    });
  });

  it("falls back to a cached session on transient fetch errors", async () => {
    const session = { user: { id: "usr_123" } };

    await expect(
      resolveSessionGate(
        makeContext({
          fetchQuery: async () => {
            throw new Error("temporary failure");
          },
          getQueryData: () => session,
        }),
        location,
      ),
    ).resolves.toEqual({ session });
  });

  it("rethrows cold-load fetch failures instead of redirecting to auth", async () => {
    const error = new Error("database unavailable");

    await expect(
      resolveSessionGate(
        makeContext({
          fetchQuery: async () => {
            throw error;
          },
        }),
        location,
      ),
    ).rejects.toBe(error);
  });
});
