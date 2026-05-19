const WHITEBOARD_TIMEOUT_MS = 5_000;

export interface WhiteboardCanvasEditAccessInput {
  sessionId: string;
  userId: string;
  role: "host" | "participant" | "guest";
}

export function getWhiteboardBaseUrls(env: Env): string[] {
  const bases = [env.WHITEBOARD_URL]
    .map((url) => (url ?? "").trim().replace(/\/+$/, ""))
    .filter(Boolean);
  return Array.from(new Set(bases));
}

function normalizeWhiteboardSessionId(sessionId: string): string {
  return sessionId.startsWith("meet-") ? sessionId : `meet-${sessionId}`;
}

export async function checkWhiteboardCanvasEditAccess(
  env: Env,
  input: WhiteboardCanvasEditAccessInput,
): Promise<{ canEditCanvas: true } | { canEditCanvas: false; status: 403 | 503; message: string }> {
  const baseUrls = getWhiteboardBaseUrls(env);
  if (baseUrls.length === 0 || !env.WHITEBOARD_INTERNAL_SECRET) {
    return { canEditCanvas: false, status: 503, message: "Whiteboard not configured" };
  }

  const body = JSON.stringify({
    sessionId: normalizeWhiteboardSessionId(input.sessionId),
    userId: input.userId,
    role: input.role,
  });

  let sawUnavailable = false;
  for (const baseUrl of baseUrls) {
    let response: Response;
    try {
      response = await fetch(`${baseUrl}/access/check`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Whiteboard-Secret": env.WHITEBOARD_INTERNAL_SECRET,
        },
        body,
        signal: AbortSignal.timeout(WHITEBOARD_TIMEOUT_MS),
      });
    } catch {
      sawUnavailable = true;
      continue;
    }

    if (!response.ok) {
      if (response.status >= 500 || response.status === 429) {
        sawUnavailable = true;
        continue;
      }
      return { canEditCanvas: false, status: 403, message: "Whiteboard edit access is required" };
    }

    const parsed = await response.json().catch(() => null);
    if (
      parsed &&
      typeof parsed === "object" &&
      ((parsed as { canEditCanvas?: unknown }).canEditCanvas === true ||
        (parsed as { canWrite?: unknown }).canWrite === true)
    ) {
      return { canEditCanvas: true };
    }
    return { canEditCanvas: false, status: 403, message: "Whiteboard edit access is required" };
  }

  return {
    canEditCanvas: false,
    status: sawUnavailable ? 503 : 403,
    message: sawUnavailable ? "Whiteboard service unavailable" : "Whiteboard edit access is required",
  };
}

export async function assertWhiteboardCanvasEditAccessResponse(
  env: Env,
  input: WhiteboardCanvasEditAccessInput,
): Promise<Response | null> {
  const result = await checkWhiteboardCanvasEditAccess(env, input);
  return result.canEditCanvas ? null : new Response(result.message, { status: result.status });
}
