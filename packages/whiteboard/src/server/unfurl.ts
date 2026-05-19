import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import {
  MAX_UNFURL_REDIRECTS,
  UnsafeUnfurlTargetError,
  assertSafeUnfurlTarget,
} from "../security";
import {
  MAX_HTTP_BODY_BYTES,
  getContentLength,
  jsonBodyErrorResponse,
  readBoundedJson,
} from "./http";

const MAX_UNFURL_RESPONSE_BYTES = 1 * 1024 * 1024;

type PinnedUnfurlResponse = {
  status: number;
  ok: boolean;
  headers: Map<string, string>;
  body: Uint8Array;
};

function getPinnedHeader(headers: Map<string, string>, name: string): string | null {
  return headers.get(name.toLowerCase()) ?? null;
}

function hostHeaderForUrl(url: URL): string {
  return url.port ? `${url.hostname}:${url.port}` : url.hostname;
}

function requestPinnedUnfurlUrl(
  url: URL,
  resolvedAddress: string,
  signal: AbortSignal,
): Promise<PinnedUnfurlResponse> {
  return new Promise((resolve, reject) => {
    const requestImpl = url.protocol === "https:" ? httpsRequest : httpRequest;
    const request = requestImpl(
      {
        protocol: url.protocol,
        hostname: resolvedAddress,
        port: url.port || (url.protocol === "https:" ? 443 : 80),
        path: `${url.pathname}${url.search}`,
        method: "GET",
        servername: url.protocol === "https:" ? url.hostname : undefined,
        lookup: (_hostname, _options, callback) => {
          callback(null, resolvedAddress, isIP(resolvedAddress) || 4);
        },
        headers: {
          Host: hostHeaderForUrl(url),
          "User-Agent": "OSSMeet/1.0 (whiteboard unfurler)",
          Accept: "text/html",
        },
      },
      (response) => {
        const chunks: Uint8Array[] = [];
        let totalBytes = 0;
        let truncated = false;
        let settled = false;

        response.on("data", (chunk: Uint8Array | Buffer) => {
          if (truncated) return;
          const bytes = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
          if (totalBytes + bytes.byteLength > MAX_UNFURL_RESPONSE_BYTES) {
            const remaining = Math.max(0, MAX_UNFURL_RESPONSE_BYTES - totalBytes);
            if (remaining > 0) {
              chunks.push(bytes.slice(0, remaining));
              totalBytes += remaining;
            }
            truncated = true;
            request.destroy();
            return;
          }
          totalBytes += bytes.byteLength;
          chunks.push(bytes);
        });

        const finish = () => {
          if (settled) return;
          settled = true;
          const body = new Uint8Array(totalBytes);
          let offset = 0;
          for (const chunk of chunks) {
            body.set(chunk, offset);
            offset += chunk.byteLength;
          }

          const headers = new Map<string, string>();
          for (const [key, value] of Object.entries(response.headers)) {
            if (Array.isArray(value)) headers.set(key.toLowerCase(), value.join(", "));
            else if (typeof value === "string") headers.set(key.toLowerCase(), value);
          }

          const status = response.statusCode ?? 0;
          resolve({ status, ok: status >= 200 && status < 300, headers, body });
        };

        response.on("end", finish);
        response.on("close", () => {
          if (truncated) finish();
        });
      },
    );

    const abort = () => request.destroy(new Error("Request aborted"));
    if (signal.aborted) abort();
    signal.addEventListener("abort", abort, { once: true });
    request.on("error", reject);
    request.on("close", () => signal.removeEventListener("abort", abort));
    request.end();
  });
}

function parseMetaTagAttributes(tag: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const attrRegex = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g;
  let match: RegExpExecArray | null;

  while ((match = attrRegex.exec(tag)) !== null) {
    const key = match[1].toLowerCase();
    const value = match[2] ?? match[3] ?? match[4] ?? "";
    attrs[key] = value;
  }

  return attrs;
}

function extractMetaTags(html: string): Map<string, string> {
  const meta = new Map<string, string>();
  const metaTagRegex = /<meta\b[^>]*>/gi;
  let match: RegExpExecArray | null;

  while ((match = metaTagRegex.exec(html)) !== null) {
    const attrs = parseMetaTagAttributes(match[0]);
    const key = (attrs.property || attrs.name || "").trim().toLowerCase();
    const content = (attrs.content || "").trim();
    if (!key || !content || meta.has(key)) continue;
    meta.set(key, content);
  }

  return meta;
}

function safeFromCodePoint(cp: number): string {
  if (!Number.isInteger(cp) || cp < 0 || cp > 0x10ffff) return "";
  if (cp <= 0x1f || (cp >= 0x7f && cp <= 0x9f)) return "";
  if (cp >= 0xd800 && cp <= 0xdfff) return "";
  return String.fromCodePoint(cp);
}

function decodeHtmlEntities(str: string): string {
  return str
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, "\u00a0")
    .replace(/&copy;/g, "\u00a9")
    .replace(/&reg;/g, "\u00ae")
    .replace(/&trade;/g, "\u2122")
    .replace(/&mdash;/g, "\u2014")
    .replace(/&ndash;/g, "\u2013")
    .replace(/&hellip;/g, "\u2026")
    .replace(/&laquo;/g, "\u00ab")
    .replace(/&raquo;/g, "\u00bb")
    .replace(/&rsquo;/g, "\u2019")
    .replace(/&lsquo;/g, "\u2018")
    .replace(/&rdquo;/g, "\u201d")
    .replace(/&ldquo;/g, "\u201c")
    .replace(/&bull;/g, "\u2022")
    .replace(/&middot;/g, "\u00b7")
    .replace(/&deg;/g, "\u00b0")
    .replace(/&plusmn;/g, "\u00b1")
    .replace(/&para;/g, "\u00b6")
    .replace(/&sect;/g, "\u00a7")
    .replace(/&euro;/g, "\u20ac")
    .replace(/&pound;/g, "\u00a3")
    .replace(/&yen;/g, "\u00a5")
    .replace(/&cent;/g, "\u00a2")
    .replace(/&times;/g, "\u00d7")
    .replace(/&divide;/g, "\u00f7")
    .replace(/&eacute;/g, "\u00e9")
    .replace(/&Eacute;/g, "\u00c9")
    .replace(/&egrave;/g, "\u00e8")
    .replace(/&agrave;/g, "\u00e0")
    .replace(/&igrave;/g, "\u00ec")
    .replace(/&ograve;/g, "\u00f2")
    .replace(/&ugrave;/g, "\u00f9")
    .replace(/&aacute;/g, "\u00e1")
    .replace(/&iacute;/g, "\u00ed")
    .replace(/&oacute;/g, "\u00f3")
    .replace(/&uacute;/g, "\u00fa")
    .replace(/&uuml;/g, "\u00fc")
    .replace(/&ouml;/g, "\u00f6")
    .replace(/&auml;/g, "\u00e4")
    .replace(/&Uuml;/g, "\u00dc")
    .replace(/&Ouml;/g, "\u00d6")
    .replace(/&Auml;/g, "\u00c4")
    .replace(/&szlig;/g, "\u00df")
    .replace(/&ccedil;/g, "\u00e7")
    .replace(/&ntilde;/g, "\u00f1")
    .replace(/&atilde;/g, "\u00e3")
    .replace(/&otilde;/g, "\u00f5")
    .replace(/&#(\d+);/g, (_, dec) => safeFromCodePoint(parseInt(dec, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => safeFromCodePoint(parseInt(hex, 16)));
}

export async function handleUnfurl(req: Request): Promise<Response> {
  const contentLength = getContentLength(req);
  if (contentLength !== null && contentLength > MAX_HTTP_BODY_BYTES) {
    return Response.json({ error: "Request too large" }, { status: 413 });
  }

  let body: { url?: string };
  try {
    body = await readBoundedJson<{ url?: string }>(req);
  } catch (error) {
    return jsonBodyErrorResponse(error);
  }

  if (!body.url || typeof body.url !== "string") {
    return Response.json({ error: "Missing url" }, { status: 400 });
  }

  let targetUrl: URL;
  try {
    targetUrl = new URL(body.url);
  } catch {
    return Response.json({ error: "Invalid URL" }, { status: 400 });
  }

  if (!["http:", "https:"].includes(targetUrl.protocol)) {
    return Response.json({ error: "Only http/https URLs supported" }, { status: 400 });
  }

  try {
    let currentUrl = targetUrl;
    let html = "";

    for (let redirects = 0; redirects <= MAX_UNFURL_REDIRECTS; redirects++) {
      const resolvedAddresses = await assertSafeUnfurlTarget(currentUrl);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);

      try {
        const resp = await requestPinnedUnfurlUrl(
          currentUrl,
          resolvedAddresses[0] ?? currentUrl.hostname,
          controller.signal,
        );

        if (resp.status >= 300 && resp.status < 400) {
          const location = getPinnedHeader(resp.headers, "Location");
          if (!location) {
            return Response.json({ title: currentUrl.hostname, url: body.url });
          }
          currentUrl = new URL(location, currentUrl);
          continue;
        }

        if (!resp.ok) {
          return Response.json({ title: currentUrl.hostname, url: body.url });
        }

        const respContentType = getPinnedHeader(resp.headers, "Content-Type") ?? "";
        if (
          !respContentType.includes("text/html") &&
          !respContentType.includes("text/plain") &&
          !respContentType.includes("application/xhtml")
        ) {
          return Response.json({ title: currentUrl.hostname, url: body.url });
        }

        html = new TextDecoder().decode(resp.body);
        targetUrl = currentUrl;
        break;
      } finally {
        clearTimeout(timeout);
      }
    }

    if (!html) {
      return Response.json({ error: "Too many redirects" }, { status: 400 });
    }

    const metadata = extractMetaTags(html);
    const getMeta = (property: string): string | null => {
      const value = metadata.get(property.toLowerCase());
      return value ? decodeHtmlEntities(value) : null;
    };

    const getTitle = (): string => {
      return (
        getMeta("og:title") ||
        getMeta("twitter:title") ||
        decodeHtmlEntities(html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.trim() || "") ||
        targetUrl.hostname
      );
    };

    const getDescription = (): string | null => {
      return getMeta("og:description") || getMeta("twitter:description") || getMeta("description");
    };

    const getImage = (): string | null => {
      const img = getMeta("og:image") || getMeta("twitter:image");
      if (!img) return null;
      try {
        return new URL(img, targetUrl.toString()).toString();
      } catch {
        return null;
      }
    };

    return Response.json({
      title: getTitle(),
      description: getDescription(),
      image: getImage(),
      url: body.url,
    });
  } catch (error) {
    if (error instanceof UnsafeUnfurlTargetError) {
      return Response.json({ error: "Unable to fetch link preview" }, { status: 400 });
    }
    return Response.json({ title: targetUrl.hostname, url: body.url });
  }
}
