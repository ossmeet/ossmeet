export class RequestBodyTooLargeError extends Error {
  constructor(public readonly limitBytes: number) {
    super(`Request body exceeds ${limitBytes} bytes`);
    this.name = "RequestBodyTooLargeError";
  }
}

/**
 * Reads a request body into memory while enforcing a strict byte limit even
 * when the sender omits or lies about Content-Length.
 */
export async function readRequestBodyBytes(
  request: Request,
  maxBytes: number,
): Promise<Uint8Array> {
  const declaredLength = Number(request.headers.get("Content-Length") ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new RequestBodyTooLargeError(maxBytes);
  }

  const stream = request.body;
  if (!stream) return new Uint8Array();

  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  let shouldCancel = false;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;

      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        shouldCancel = true;
        throw new RequestBodyTooLargeError(maxBytes);
      }

      chunks.push(value);
    }
  } finally {
    if (shouldCancel) {
      await reader.cancel().catch(() => undefined);
    }
    reader.releaseLock();
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

export async function readRequestBodyText(
  request: Request,
  maxBytes: number,
): Promise<string> {
  const bytes = await readRequestBodyBytes(request, maxBytes);
  return new TextDecoder().decode(bytes);
}
