import { beforeEach, describe, expect, it, vi } from "vitest";
import { enforceRateLimit } from "../helpers.ts";
import { logError, logWarn } from "@/lib/logger";

vi.mock("@/lib/logger", () => ({
  logError: vi.fn(),
  logWarn: vi.fn(),
}));

function createEnv(overrides: Partial<Env> = {}): Env {
  return {
    ENVIRONMENT: "development",
    ALLOW_MEMORY_RATE_LIMIT: "true",
    RATE_LIMITER: undefined,
    AUTH_RATE_LIMITER: undefined,
    ...overrides,
  } as unknown as Env;
}

describe("enforceRateLimit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects requests when no binding exists and memory fallback is disabled", async () => {
    await expect(
      enforceRateLimit(
        createEnv({
          ENVIRONMENT: "staging",
          ALLOW_MEMORY_RATE_LIMIT: "false",
        }),
        "login:user@example.com",
        true,
      ),
    ).rejects.toMatchObject({ code: "CONFIG_ERROR" });

    expect(logError).toHaveBeenCalledTimes(1);
    const [message, payload] = vi.mocked(logError).mock.calls[0];
    expect(message).not.toContain("user@example.com");
    expect(payload).toMatchObject({
      environment: "staging",
      keyScope: "login",
    });
    expect((payload as { keyHash: string }).keyHash).toMatch(/^[0-9a-f]{12}$/);
  });

  it("uses the in-memory fallback only when explicitly enabled", async () => {
    await expect(
      enforceRateLimit(
        createEnv({
          ENVIRONMENT: "development",
          ALLOW_MEMORY_RATE_LIMIT: "true",
        }),
        "login:user@example.com",
        true,
      ),
    ).resolves.toBeUndefined();

    expect(logWarn).toHaveBeenCalledTimes(1);
    const [message, payload] = vi.mocked(logWarn).mock.calls[0];
    expect(message).not.toContain("user@example.com");
    expect(payload).toMatchObject({
      environment: "development",
      keyScope: "login",
    });
    expect((payload as { keyHash: string }).keyHash).toMatch(/^[0-9a-f]{12}$/);
  });

  it("still enforces the auth fallback ceiling when enabled", async () => {
    const key = `login:${crypto.randomUUID()}@example.com`;
    const env = createEnv();

    for (let attempt = 0; attempt < 60; attempt++) {
      await expect(enforceRateLimit(env, key, true)).resolves.toBeUndefined();
    }

    await expect(enforceRateLimit(env, key, true)).rejects.toMatchObject({
      code: "RATE_LIMITED",
    });
  });
});
