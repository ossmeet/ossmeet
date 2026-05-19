export interface ImageDimensions {
  width: number;
  height: number;
}

const HEADER_BYTES = 65536;

export async function readImageDimensionsFromFile(
  file: File,
): Promise<ImageDimensions | null> {
  const slice = file.slice(0, Math.min(file.size, HEADER_BYTES));
  const buf = new Uint8Array(await slice.arrayBuffer());
  return parseImageDimensions(buf, file.type);
}

function parseImageDimensions(
  buf: Uint8Array,
  mimeType: string,
): ImageDimensions | null {
  if (mimeType === "image/png" || isPng(buf)) return parsePng(buf);
  if (mimeType === "image/jpeg" || isJpeg(buf)) return parseJpeg(buf);
  if (mimeType === "image/gif" || isGif(buf)) return parseGif(buf);
  if (mimeType === "image/webp" || isWebP(buf)) return parseWebP(buf);
  return null;
}

function isPng(buf: Uint8Array): boolean {
  return buf.length >= 24 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
}

function isJpeg(buf: Uint8Array): boolean {
  return buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xd8;
}

function isGif(buf: Uint8Array): boolean {
  return buf.length >= 10 && buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46;
}

function isWebP(buf: Uint8Array): boolean {
  return (
    buf.length >= 12 &&
    buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
    buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50
  );
}

function parsePng(buf: Uint8Array): ImageDimensions | null {
  if (buf.length < 24) return null;
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

function parseGif(buf: Uint8Array): ImageDimensions | null {
  if (buf.length < 10) return null;
  const width = buf[6] | (buf[7] << 8);
  const height = buf[8] | (buf[9] << 8);
  return { width, height };
}

function parseJpeg(buf: Uint8Array): ImageDimensions | null {
  if (buf.length < 2) return null;
  let offset = 2;
  while (offset + 4 < buf.length) {
    if (buf[offset] !== 0xff) return null;
    const marker = buf[offset + 1];

    if (marker === 0xd9) return null; // EOI
    if (marker === 0xda) return null; // SOS — no SOF found before scan data

    // SOF markers: C0-CF except C4 (DHT), C8 (reserved), CC (DAC)
    if (
      marker >= 0xc0 && marker <= 0xcf &&
      marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
    ) {
      if (offset + 9 > buf.length) return null;
      const height = (buf[offset + 5] << 8) | buf[offset + 6];
      const width = (buf[offset + 7] << 8) | buf[offset + 8];
      return { width, height };
    }

    // Skip segment
    const segLen = (buf[offset + 2] << 8) | buf[offset + 3];
    offset += 2 + segLen;
  }
  return null;
}

function parseWebP(buf: Uint8Array): ImageDimensions | null {
  if (buf.length < 16) return null;

  // Find chunk type at offset 12
  const chunk = String.fromCharCode(buf[12], buf[13], buf[14], buf[15]);

  if (chunk === "VP8 " && buf.length >= 30) {
    // Lossy: keyframe starts at offset 20 (after 12 RIFF + 4 type + 4 size)
    // Frame tag 3 bytes, then sync code 0x9D 0x01 0x2A
    const dataStart = 20;
    if (
      buf[dataStart + 3] === 0x9d &&
      buf[dataStart + 4] === 0x01 &&
      buf[dataStart + 5] === 0x2a
    ) {
      const width = (buf[dataStart + 6] | (buf[dataStart + 7] << 8)) & 0x3fff;
      const height = (buf[dataStart + 8] | (buf[dataStart + 9] << 8)) & 0x3fff;
      return { width, height };
    }
  }

  if (chunk === "VP8L" && buf.length >= 25) {
    // Lossless: signature byte 0x2F at offset 20, then 4 bytes of packed dimensions
    const dataStart = 20;
    if (buf[dataStart] === 0x2f) {
      const bits =
        buf[dataStart + 1] |
        (buf[dataStart + 2] << 8) |
        (buf[dataStart + 3] << 16) |
        (buf[dataStart + 4] << 24);
      const width = (bits & 0x3fff) + 1;
      const height = ((bits >> 14) & 0x3fff) + 1;
      return { width, height };
    }
  }

  if (chunk === "VP8X" && buf.length >= 30) {
    // Extended: canvas dimensions at data offset 4 (24-bit LE each)
    const dataStart = 20;
    const width = 1 + (buf[dataStart + 4] | (buf[dataStart + 5] << 8) | (buf[dataStart + 6] << 16));
    const height = 1 + (buf[dataStart + 7] | (buf[dataStart + 8] << 8) | (buf[dataStart + 9] << 16));
    return { width, height };
  }

  return null;
}
