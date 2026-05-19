import { createDb } from "@ossmeet/db";
import { enforceRateLimit } from "@/server/auth/helpers";
import { withTimeout } from "@/lib/with-timeout";
import { verifyActiveWhiteboardBearer } from "./active-whiteboard-auth";

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

function resolveWikiRedirect(location: string | null, baseUrl: string): string | Response {
  if (!location) return new Response("Upstream redirect missing location", { status: 502 });
  try {
    const nextUrl = new URL(location, baseUrl).toString();
    if (!isAllowedWikiImageUrl(nextUrl)) {
      return new Response("Upstream redirect target is not allowed", { status: 502 });
    }
    return nextUrl;
  } catch {
    return new Response("Upstream redirect target is invalid", { status: 502 });
  }
}

export async function handleWiki(request: Request, env: Env): Promise<Response> {
  const db = createDb(env.DB);
  const auth = await verifyActiveWhiteboardBearer(request, env, db);
  if (auth instanceof Response) return auth;

  const principal = auth.access.userId
    ? auth.access.userId
    : auth.access.admissionId ?? auth.access.connectionId;
  try {
    await enforceRateLimit(env, `wiki:${principal}`);
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
      const res = await withTimeout(
        (signal) =>
          fetch(apiUrl.toString(), {
            headers: { "User-Agent": "OSSMeet/1.0" },
            signal,
          }),
        5000,
      );
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
      const res = await withTimeout(
        (signal) =>
          fetch(apiUrl.toString(), {
            headers: { "User-Agent": "OSSMeet/1.0" },
            signal,
          }),
        5000,
      );
      if (!res.ok) return new Response("Upstream error", { status: 502 });
      const data = await res.json();
      return Response.json(data);
    }

    if (type === "summary") {
      if (!title || title.length > 300) {
        return new Response("Bad request", { status: 400 });
      }
      const encoded = encodeURIComponent(title.replace(/ /g, "_"));
      const res = await withTimeout(
        (signal) =>
          fetch(`${WIKIPEDIA_REST}/page/summary/${encoded}`, {
            headers: { "User-Agent": "OSSMeet/1.0" },
            signal,
          }),
        5000,
      );
      if (!res.ok) return new Response("Upstream error", { status: 502 });
      const data = await res.json();
      return Response.json(data);
    }

    if (type === "image-proxy") {
      if (!imageUrl || imageUrl.length > 2000 || !isAllowedWikiImageUrl(imageUrl)) {
        return new Response("Bad request", { status: 400 });
      }

      let currentImageUrl = imageUrl;
      let res: Response | null = null;
      for (let redirects = 0; redirects <= 3; redirects++) {
        res = await withTimeout(
          (signal) =>
            fetch(currentImageUrl, {
              headers: { "User-Agent": "OSSMeet/1.0" },
              redirect: "manual",
              signal,
            }),
          5000,
        );

        if (res.status < 300 || res.status >= 400) break;
        const nextUrl = resolveWikiRedirect(res.headers.get("Location"), currentImageUrl);
        if (nextUrl instanceof Response) return nextUrl;
        currentImageUrl = nextUrl;
        res = null;
      }

      if (!res) {
        return new Response("Too many redirects", { status: 502 });
      }

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
}
