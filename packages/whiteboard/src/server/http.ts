export const MAX_HTTP_BODY_BYTES = 64 * 1024;
const HTTP_BODY_READ_TIMEOUT_MS = 30_000;

export function getContentLength(req: Request): number | null {
  const header = req.headers.get("Content-Length");
  if (!header) return null;
  const size = Number.parseInt(header, 10);
  return Number.isFinite(size) ? size : null;
}

export async function readBoundedJson<T>(
  req: Request,
  maxBytes = MAX_HTTP_BODY_BYTES,
): Promise<T> {
  const contentLength = getContentLength(req);
  if (contentLength !== null && contentLength > maxBytes) {
    throw new Error("payload_too_large");
  }

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  if (req.body) {
    const signal = AbortSignal.timeout(HTTP_BODY_READ_TIMEOUT_MS);
    const reader = req.body.getReader();
    const timeoutPromise = new Promise<never>((_, reject) => {
      signal.addEventListener("abort", () => reject(new Error("read_timeout")), { once: true });
    });
    try {
      while (true) {
        const { done, value } = await Promise.race([reader.read(), timeoutPromise]);
        if (done) break;
        totalBytes += value.byteLength;
        if (totalBytes > maxBytes) {
          await reader.cancel();
          throw new Error("payload_too_large");
        }
        chunks.push(value);
      }
    } catch (e) {
      await reader.cancel().catch(() => {});
      throw e;
    }
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    return JSON.parse(new TextDecoder().decode(body)) as T;
  } catch {
    throw new Error("invalid_json");
  }
}

export function jsonBodyErrorResponse(error: unknown): Response {
  if (error instanceof Error) {
    if (error.message === "payload_too_large") {
      return Response.json({ error: "Payload too large" }, { status: 413 });
    }
    if (error.message === "read_timeout") {
      return Response.json({ error: "Request timeout" }, { status: 408 });
    }
  }
  return Response.json({ error: "Invalid JSON" }, { status: 400 });
}

const SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
};

export function addSecurityHeaders(resp: Response): Response {
  const result = new Response(resp.body, resp);
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) {
    result.headers.set(k, v);
  }
  return result;
}

export function createCorsHelpers({
  allowedOrigins,
  allowInsecureAllOrigins,
}: {
  allowedOrigins: string[];
  allowInsecureAllOrigins: boolean;
}) {
  function corsHeaders(req: Request): Record<string, string> {
    const origin = req.headers.get("Origin");
    if (!origin) return {};
    if (allowedOrigins.length > 0 && !allowedOrigins.includes(origin)) return {};
    if (allowedOrigins.length === 0 && !allowInsecureAllOrigins) return {};
    return {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Whiteboard-Secret",
      "Access-Control-Max-Age": "86400",
    };
  }

  function withCors(response: Response, req: Request): Response {
    const headers = corsHeaders(req);
    const resp = new Response(response.body, response);
    resp.headers.set("Vary", "Origin");
    for (const [k, v] of Object.entries(headers)) resp.headers.set(k, v);
    return addSecurityHeaders(resp);
  }

  return { corsHeaders, withCors };
}
