import { createFileRoute } from "@tanstack/react-router";
import { enforceRateLimit, getEnvFromRequest, verifySessionFromRawRequest } from "@/server/auth/helpers";
import { verifyWhiteboardJWT } from "@/lib/jwt-utils";
import { withTimeout } from "@/lib/with-timeout";

const WIKIPEDIA_API = "https://en.wikipedia.org/w/api.php";
const WIKIPEDIA_REST = "https://en.wikipedia.org/api/rest_v1";

function isAllowedWikiImageUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    return (
      parsed.protocol === "https:" &&
      (parsed.hostname === "upload.wikimedia.org" ||
        parsed.hostname.endsWith(".upload.wikimedia.org"))
    );
  } catch {
    return false;
  }
}

/**
 * Proxies Wikipedia API requests server-side so no external connect-src
 * entry is needed in the browser CSP.
 *
 * GET /api/wiki?type=search&q=<query>
 * GET /api/wiki?type=article&title=<title>
 * GET /api/wiki?type=summary&title=<title>
 */
export const Route = createFileRoute("/api/wiki")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const env = await getEnvFromRequest(request);
        if (!env) return new Response("Server configuration error", { status: 500 });

        // Require authentication to prevent open-proxy abuse.
        // also accept a valid whiteboard JWT so guests in a meeting can use image-proxy.
        const session = await verifySessionFromRawRequest(request, env);
        if (!session) {
          const authHeader = request.headers.get("Authorization");
          const bearerToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7).trim() : null;
          if (!bearerToken || !env.WHITEBOARD_JWT_SECRET) {
            return new Response("Unauthorized", { status: 401 });
          }
          try {
            await verifyWhiteboardJWT(bearerToken, env.WHITEBOARD_JWT_SECRET);
          } catch {
            return new Response("Unauthorized", { status: 401 });
          }
        }

        // Rate limit by IP to prevent cost abuse via egress inflation
        const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
        try {
          await enforceRateLimit(env, `wiki:${ip}`);
        } catch {
          return new Response("Too many requests", { status: 429 });
        }

        const url = new URL(request.url);
        const type = url.searchParams.get("type");
        const q = url.searchParams.get("q");
        const title = url.searchParams.get("title");
        const imageUrl = url.searchParams.get("imageUrl");

        try {
          if (type === "search") {
            if (!q || q.length > 300) {
              return new Response("Bad request", { status: 400 });
            }
            const apiUrl = new URL(WIKIPEDIA_API);
            apiUrl.searchParams.set("action", "query");
            apiUrl.searchParams.set("list", "search");
            apiUrl.searchParams.set("srsearch", q);
            apiUrl.searchParams.set("srlimit", "5");
            apiUrl.searchParams.set("format", "json");
            const res = await withTimeout(fetch(apiUrl.toString(), {
              headers: { "User-Agent": "OSSMeet/1.0" },
            }), 5000);
            if (!res.ok) return new Response("Upstream error", { status: 502 });
            const data = await res.json();
            return Response.json(data);
          }

          if (type === "article") {
            if (!title || title.length > 300) {
              return new Response("Bad request", { status: 400 });
            }
            const apiUrl = new URL(WIKIPEDIA_API);
            apiUrl.searchParams.set("action", "query");
            apiUrl.searchParams.set("prop", "extracts");
            apiUrl.searchParams.set("exintro", "true");
            apiUrl.searchParams.set("titles", title);
            apiUrl.searchParams.set("format", "json");
            const res = await withTimeout(fetch(apiUrl.toString(), {
              headers: { "User-Agent": "OSSMeet/1.0" },
            }), 5000);
            if (!res.ok) return new Response("Upstream error", { status: 502 });
            const data = await res.json();
            return Response.json(data);
          }

          if (type === "summary") {
            if (!title || title.length > 300) {
              return new Response("Bad request", { status: 400 });
            }
            const encoded = encodeURIComponent(title.replace(/ /g, "_"));
            const res = await fetch(`${WIKIPEDIA_REST}/page/summary/${encoded}`, {
              headers: { "User-Agent": "OSSMeet/1.0" },
            });
            if (!res.ok) return new Response("Upstream error", { status: 502 });
            const data = await res.json();
            return Response.json(data);
          }

          if (type === "image-proxy") {
            if (!imageUrl || imageUrl.length > 2000 || !isAllowedWikiImageUrl(imageUrl)) {
              return new Response("Bad request", { status: 400 });
            }

            const res = await withTimeout(fetch(imageUrl, {
              headers: { "User-Agent": "OSSMeet/1.0" },
            }), 5000);

            if (!res.ok) {
              return new Response("Upstream error", { status: 502 });
            }

            const contentType = res.headers.get("content-type");
            if (!contentType?.startsWith("image/")) {
              return new Response("Upstream did not return an image", { status: 502 });
            }

            const contentLength = res.headers.get("content-length");
            if (contentLength && Number(contentLength) > 10 * 1024 * 1024) {
              return new Response("Image too large", { status: 413 });
            }

            // Buffer with a streaming byte counter so chunked responses without
            // Content-Length cannot bypass the 10 MB limit.
            const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
            if (res.body) {
              const reader = res.body.getReader();
              const chunks: Uint8Array[] = [];
              let totalBytes = 0;
              while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                if (value) {
                  totalBytes += value.byteLength;
                  if (totalBytes > MAX_IMAGE_BYTES) {
                    await reader.cancel();
                    return new Response("Image too large", { status: 413 });
                  }
                  chunks.push(value);
                }
              }
              const body = new Uint8Array(totalBytes);
              let offset = 0;
              for (const chunk of chunks) {
                body.set(chunk, offset);
                offset += chunk.byteLength;
              }
              return new Response(body, {
                status: 200,
                headers: {
                  "Content-Type": contentType,
                  "Cache-Control": "private, max-age=300",
                },
              });
            }

            return new Response(res.body, {
              status: 200,
              headers: {
                "Content-Type": contentType,
                "Cache-Control": "private, max-age=300",
              },
            });
          }

          return new Response("Bad request", { status: 400 });
        } catch {
          return new Response("Upstream error", { status: 502 });
        }
      },
    },
  },
});
