import { randomUUID } from "node:crypto";
import { mkdir, readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { AwsClient } from "aws4fetch";
import { sortPageFiles } from "./lib/sort-page-files";
import { PDF_MAX_IMPORT_SIZE, PDF_MAX_IMPORT_PAGES } from "./lib/pdf-geometry";

const TMP_DIR = "/tmp/pdf-render";
const RENDER_DPI = 144; // 2× base 72 DPI
const RENDER_TIMEOUT_MS = 30_000;
const BODY_READ_TIMEOUT_MS = 30_000;
const JOB_TTL_MS = 5 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 60 * 1000;

const MAX_CONCURRENT_RENDERS = 3;
const COMMIT_CONCURRENCY = 4;
let activeRenders = 0;

const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 5;
const userRenderTimestamps = new Map<string, number[]>();

const PDF_MAGIC = new Uint8Array([0x25, 0x50, 0x44, 0x46]); // %PDF

interface R2UploadConfig {
  accessKeyId: string;
  secretAccessKey: string;
  accountId: string;
  bucketName: string;
}

interface Job {
  dir: string;
  userId: string;
  pages: { width: number; height: number }[];
  filenames: string[];
  lastAccessedAt: number;
}

const jobs = new Map<string, Job>();

setInterval(async () => {
  const now = Date.now();
  for (const [id, job] of jobs) {
    if (now - job.lastAccessedAt > JOB_TTL_MS) {
      jobs.delete(id);
      rm(job.dir, { recursive: true, force: true }).catch(() => {});
    }
  }
  for (const [userId, timestamps] of userRenderTimestamps) {
    const fresh = timestamps.filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
    if (fresh.length === 0) userRenderTimestamps.delete(userId);
    else userRenderTimestamps.set(userId, fresh);
  }
}, CLEANUP_INTERVAL_MS);

function touchJob(job: Job): void {
  job.lastAccessedAt = Date.now();
}

function checkUserRateLimit(userId: string): boolean {
  const now = Date.now();
  const timestamps = userRenderTimestamps.get(userId) ?? [];
  const recent = timestamps.filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  if (recent.length >= RATE_LIMIT_MAX_REQUESTS) return false;
  recent.push(now);
  userRenderTimestamps.set(userId, recent);
  return true;
}

async function readRequestBodyBytes(req: Request, maxBytes: number): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  if (!req.body) return new Uint8Array();

  // Timeout prevents slow-loris attacks where a client trickles data to hold
  // the connection open indefinitely.
  const signal = AbortSignal.timeout(BODY_READ_TIMEOUT_MS);
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

  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

function readPngDimensions(buf: Uint8Array): { width: number; height: number } {
  if (buf.byteLength < 24) {
    throw new Error(`PNG header too short: ${buf.byteLength} bytes (need >= 24)`);
  }
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const MAX_PNG_DIMENSION = 16384;
  return {
    width: Math.min(view.getUint32(16), MAX_PNG_DIMENSION),
    height: Math.min(view.getUint32(20), MAX_PNG_DIMENSION),
  };
}

function isPdf(buf: Uint8Array): boolean {
  if (buf.length < 4) return false;
  return buf[0] === PDF_MAGIC[0]
    && buf[1] === PDF_MAGIC[1]
    && buf[2] === PDF_MAGIC[2]
    && buf[3] === PDF_MAGIC[3];
}

async function cleanupOrphanedDirs(): Promise<void> {
  try {
    const entries = await readdir(TMP_DIR);
    for (const entry of entries) {
      if (!jobs.has(entry)) {
        rm(join(TMP_DIR, entry), { recursive: true, force: true }).catch(() => {});
      }
    }
  } catch {
    // TMP_DIR may not exist yet
  }
}

async function uploadCommittedPagesWithPool<T>(
  count: number,
  worker: (index: number) => Promise<T>,
): Promise<T[]> {
  const results = new Array<T>(count);
  let nextIndex = 0;

  async function runWorker(): Promise<void> {
    while (nextIndex < count) {
      const index = nextIndex++;
      results[index] = await worker(index);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(COMMIT_CONCURRENCY, count) }, () => runWorker()),
  );

  return results;
}

function buildR2UploadClient(config: R2UploadConfig): {
  client: AwsClient;
  endpoint: string;
} {
  return {
    client: new AwsClient({
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    }),
    endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
  };
}

export async function handlePdfRender(req: Request, userId?: string): Promise<Response> {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  if (userId && !checkUserRateLimit(userId)) {
    return Response.json(
      { error: "Too many PDF render requests. Please wait a minute." },
      { status: 429 },
    );
  }

  const contentLength = req.headers.get("Content-Length");
  if (!contentLength) {
    return Response.json({ error: "Content-Length header is required" }, { status: 411 });
  }
  const parsedContentLength = Number(contentLength);
  if (!Number.isFinite(parsedContentLength) || parsedContentLength < 0) {
    return Response.json({ error: "Invalid Content-Length header" }, { status: 400 });
  }
  if (parsedContentLength > PDF_MAX_IMPORT_SIZE) {
    return Response.json({ error: "PDF too large (max 50 MB)" }, { status: 413 });
  }

  if (activeRenders >= MAX_CONCURRENT_RENDERS) {
    return Response.json(
      { error: "Server is busy rendering other PDFs. Please try again shortly." },
      { status: 503 },
    );
  }

  activeRenders++;
  try {
    let body: Uint8Array;
    try {
      body = await readRequestBodyBytes(req, PDF_MAX_IMPORT_SIZE);
    } catch (err) {
      if (err instanceof Error && err.message === "payload_too_large") {
        return Response.json({ error: "PDF too large (max 50 MB)" }, { status: 413 });
      }
      throw err;
    }
    if (body.byteLength === 0) {
      return Response.json({ error: "PDF body is required" }, { status: 400 });
    }
    if (body.byteLength > PDF_MAX_IMPORT_SIZE) {
      return Response.json({ error: "PDF too large (max 50 MB)" }, { status: 413 });
    }
    if (!isPdf(body)) {
      return Response.json({ error: "Not a valid PDF" }, { status: 400 });
    }

    const id = randomUUID();
    const dir = join(TMP_DIR, id);
    await mkdir(dir, { recursive: true });

    const pdfPath = join(dir, "input.pdf");
    await Bun.write(pdfPath, body);

    const outputPrefix = join(dir, "page");
    const proc = Bun.spawn(
      ["mutool", "draw", "-q", "-r", String(RENDER_DPI), "-F", "png", "-o", `${outputPrefix}-%d.png`, pdfPath],
      { stdout: "ignore", stderr: "pipe" },
    );
    const timer = setTimeout(() => proc.kill(), RENDER_TIMEOUT_MS);
    const [exitCode, stderr] = await Promise.all([
      proc.exited,
      new Response(proc.stderr).text(),
    ]);
    clearTimeout(timer);

    if (exitCode !== 0) {
      console.error(`[pdf-render] mutool failed (exit ${exitCode}): ${stderr}`);
      await rm(dir, { recursive: true, force: true });
      return Response.json({ error: "Failed to render PDF" }, { status: 500 });
    }

    const entries = await readdir(dir);
    const pngFiles = sortPageFiles(
      entries.filter((f) => f.startsWith("page-") && f.endsWith(".png")),
    );

    if (pngFiles.length === 0) {
      await rm(dir, { recursive: true, force: true });
      return Response.json({ error: "PDF produced no pages" }, { status: 400 });
    }

    if (pngFiles.length > PDF_MAX_IMPORT_PAGES) {
      await rm(dir, { recursive: true, force: true });
      return Response.json(
        { error: `Too many pages (${pngFiles.length}, max ${PDF_MAX_IMPORT_PAGES})` },
        { status: 400 },
      );
    }

    const pages: Job["pages"] = [];
    for (const f of pngFiles) {
      const header = await Bun.file(join(dir, f)).slice(0, 24).arrayBuffer();
      const dims = readPngDimensions(new Uint8Array(header));
      pages.push(dims);
    }

    await rm(pdfPath, { force: true });

    jobs.set(id, {
      dir,
      userId: userId ?? "",
      pages,
      filenames: pngFiles,
      lastAccessedAt: Date.now(),
    });

    return Response.json({ id, pages });
  } catch (err) {
    console.error("[pdf-render] unexpected error:", err);
    return Response.json({ error: "Internal error" }, { status: 500 });
  } finally {
    activeRenders--;
  }
}

export async function handlePdfRenderPage(
  req: Request,
  id: string,
  pageIndex: number,
  userId?: string,
): Promise<Response> {
  if (req.method !== "GET") {
    return new Response("Method not allowed", { status: 405 });
  }

  const job = jobs.get(id);
  if (!job) {
    return new Response("Not found", { status: 404 });
  }

  if (userId && job.userId && job.userId !== userId) {
    return new Response("Forbidden", { status: 403 });
  }

  touchJob(job);

  if (pageIndex < 0 || pageIndex >= job.pages.length) {
    return new Response("Page not found", { status: 404 });
  }

  const filename = job.filenames[pageIndex];
  if (!filename) {
    return new Response("Page not found", { status: 404 });
  }

  const filePath = join(job.dir, filename);
  try {
    await stat(filePath);
  } catch {
    return new Response("Page not found", { status: 404 });
  }

  const file = Bun.file(filePath);
  return new Response(file, {
    headers: { "Content-Type": "image/png" },
  });
}

interface ImportGrantResponse {
  uploadPrefix: string;
}

export async function handlePdfRenderCommit(
  req: Request,
  id: string,
  meetingSid: string,
  connectionId: string,
  participantIdentity: string,
  appUrl: string,
  internalSecret: string,
  r2Config: R2UploadConfig,
  userId?: string,
): Promise<Response> {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const job = jobs.get(id);
  if (!job) {
    return new Response("Not found", { status: 404 });
  }

  if (userId && job.userId && job.userId !== userId) {
    return new Response("Forbidden", { status: 403 });
  }

  touchJob(job);

  const failedIndices: number[] = [];

  try {
    let totalBytes = 0;
    for (const filename of job.filenames) {
      totalBytes += Bun.file(join(job.dir, filename)).size;
    }

    const grantResponse = await fetch(new URL("/api/whiteboard/pdf-import-grant", appUrl).toString(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Whiteboard-Secret": internalSecret,
      },
      body: JSON.stringify({
        meetingId: meetingSid,
        connectionId,
        participantIdentity,
        importId: id,
        pageCount: job.filenames.length,
        totalBytes,
      }),
    });

    if (!grantResponse.ok) {
      const errorText = await grantResponse.text().catch(() => "");
      return Response.json(
        {
          error: errorText || "Failed to acquire PDF import grant",
          pages: [],
          failedIndices: job.filenames.map((_, index) => index),
        },
        { status: grantResponse.status >= 400 ? grantResponse.status : 500 },
      );
    }

    const grant = await grantResponse.json() as ImportGrantResponse;
    const { client: r2, endpoint } = buildR2UploadClient(r2Config);

    const uploadedPages = await uploadCommittedPagesWithPool(job.filenames.length, async (index) => {
      try {
        const filename = job.filenames[index];
        const file = Bun.file(join(job.dir, filename));
        const r2Key = `${grant.uploadPrefix}page-${index + 1}.png`;
        const url = new URL(`/${r2Config.bucketName}/${r2Key}`, endpoint);
        const response = await r2.fetch(url.toString(), {
          method: "PUT",
          headers: {
            "Content-Type": "image/png",
            "Content-Length": String(file.size),
          },
          body: file,
        });

        if (!response.ok) {
          const errorText = await response.text().catch(() => "");
          throw new Error(errorText || `R2 upload failed (${response.status})`);
        }

        return {
          index,
          r2Key,
          size: file.size,
        };
      } catch (err) {
        failedIndices.push(index);
        console.error(`[pdf-render] failed to commit page ${index + 1}:`, err);
        return null;
      }
    });

    const pages = uploadedPages.filter(
      (page): page is NonNullable<typeof page> => page !== null,
    );

    if (pages.length === 0) {
      return Response.json(
        {
          error: "Failed to persist rendered PDF pages",
          pages: [],
          failedIndices,
        },
        { status: 500 },
      );
    }

    return Response.json({
      pages,
      failedIndices,
    });
  } catch (err) {
    console.error("[pdf-render] commit failed:", err);
    return Response.json(
      {
        error: "Failed to persist rendered PDF pages",
        pages: [],
        failedIndices: failedIndices.length > 0
          ? failedIndices
          : job.filenames.map((_, index) => index),
      },
      { status: 500 },
    );
  }
}

export async function handlePdfRenderCleanup(
  req: Request,
  id: string,
  userId?: string,
): Promise<Response> {
  if (req.method !== "DELETE") {
    return new Response("Method not allowed", { status: 405 });
  }

  const job = jobs.get(id);
  if (job) {
    if (userId && job.userId && job.userId !== userId) {
      return new Response("Forbidden", { status: 403 });
    }
    jobs.delete(id);
    rm(job.dir, { recursive: true, force: true }).catch(() => {});
  }

  return new Response(null, { status: 204 });
}

export function parsePdfRenderPath(
  pathname: string,
): (
  | { type: "render" }
  | { type: "page"; id: string; pageIndex: number }
  | { type: "commit"; id: string }
  | { type: "cleanup"; id: string }
) | null {
  if (pathname === "/pdf-render") {
    return { type: "render" };
  }

  const pageMatch = pathname.match(/^\/pdf-render\/([0-9a-f-]{36})\/(\d{1,5})$/);
  if (pageMatch) {
    return { type: "page", id: pageMatch[1], pageIndex: parseInt(pageMatch[2], 10) };
  }

  const commitMatch = pathname.match(/^\/pdf-render\/([0-9a-f-]{36})\/commit$/);
  if (commitMatch) {
    return { type: "commit", id: commitMatch[1] };
  }

  const cleanupMatch = pathname.match(/^\/pdf-render\/([0-9a-f-]{36})$/);
  if (cleanupMatch) {
    return { type: "cleanup", id: cleanupMatch[1] };
  }

  return null;
}

mkdir(TMP_DIR, { recursive: true })
  .then(() => cleanupOrphanedDirs())
  .catch(() => {});
