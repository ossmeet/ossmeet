import { describe, expect, it } from "vitest";
import { readImageDimensionsFromFile } from "./read-image-dimensions";

function makeFile(bytes: Uint8Array, name: string, type: string): File {
  return new File([bytes as BlobPart], name, { type });
}

// Minimal valid PNG: 8-byte signature + IHDR chunk (13 bytes data)
function buildPng(width: number, height: number): Uint8Array {
  const buf = new Uint8Array(33);
  // PNG signature
  buf.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  // IHDR chunk length (13)
  buf.set([0, 0, 0, 13], 8);
  // IHDR tag
  buf.set([0x49, 0x48, 0x44, 0x52], 12);
  // Width (big-endian)
  new DataView(buf.buffer).setUint32(16, width);
  // Height (big-endian)
  new DataView(buf.buffer).setUint32(20, height);
  return buf;
}

// Minimal GIF header
function buildGif(width: number, height: number): Uint8Array {
  const buf = new Uint8Array(10);
  buf.set([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]); // GIF89a
  buf[6] = width & 0xff;
  buf[7] = (width >> 8) & 0xff;
  buf[8] = height & 0xff;
  buf[9] = (height >> 8) & 0xff;
  return buf;
}

// Minimal JPEG with SOF0 marker
function buildJpeg(width: number, height: number): Uint8Array {
  const buf = new Uint8Array(20);
  buf[0] = 0xff; buf[1] = 0xd8; // SOI
  buf[2] = 0xff; buf[3] = 0xc0; // SOF0
  buf[4] = 0x00; buf[5] = 0x11; // segment length = 17
  buf[6] = 0x08; // precision
  buf[7] = (height >> 8) & 0xff; buf[8] = height & 0xff;
  buf[9] = (width >> 8) & 0xff; buf[10] = width & 0xff;
  return buf;
}

// JPEG with APP0 (JFIF) + APP1 (EXIF) segments before SOF0
function buildJpegWithExif(width: number, height: number): Uint8Array {
  const buf = new Uint8Array(40);
  let o = 0;
  buf[o++] = 0xff; buf[o++] = 0xd8; // SOI
  // APP0 segment (marker + length 8 = 6 bytes data)
  buf[o++] = 0xff; buf[o++] = 0xe0; // APP0
  buf[o++] = 0x00; buf[o++] = 0x08; // segment length = 8
  o += 6; // skip data bytes
  // APP1 segment (marker + length 6 = 4 bytes data)
  buf[o++] = 0xff; buf[o++] = 0xe1; // APP1
  buf[o++] = 0x00; buf[o++] = 0x06; // segment length = 6
  o += 4; // skip data bytes
  // SOF0
  buf[o++] = 0xff; buf[o++] = 0xc0;
  buf[o++] = 0x00; buf[o++] = 0x11; // segment length = 17
  buf[o++] = 0x08; // precision
  buf[o++] = (height >> 8) & 0xff; buf[o] = height & 0xff; o++;
  buf[o++] = (width >> 8) & 0xff; buf[o] = width & 0xff;
  return buf;
}

// WebP VP8X (extended format)
function buildWebPVP8X(width: number, height: number): Uint8Array {
  const buf = new Uint8Array(30);
  // RIFF header
  buf.set([0x52, 0x49, 0x46, 0x46]); // "RIFF"
  buf.set([0x00, 0x00, 0x00, 0x00], 4); // file size (unused for test)
  buf.set([0x57, 0x45, 0x42, 0x50], 8); // "WEBP"
  // VP8X chunk
  buf.set([0x56, 0x50, 0x38, 0x58], 12); // "VP8X"
  buf.set([0x0a, 0x00, 0x00, 0x00], 16); // chunk size = 10
  // 4 bytes flags at offset 20
  buf[20] = 0x00; buf[21] = 0x00; buf[22] = 0x00; buf[23] = 0x00;
  // canvas width - 1 (24-bit LE) at offset 24
  const w = width - 1;
  buf[24] = w & 0xff; buf[25] = (w >> 8) & 0xff; buf[26] = (w >> 16) & 0xff;
  // canvas height - 1 (24-bit LE) at offset 27
  const h = height - 1;
  buf[27] = h & 0xff; buf[28] = (h >> 8) & 0xff; buf[29] = (h >> 16) & 0xff;
  return buf;
}

describe("readImageDimensionsFromFile", () => {
  it("reads PNG dimensions from header", async () => {
    const file = makeFile(buildPng(1920, 1080), "test.png", "image/png");
    const dims = await readImageDimensionsFromFile(file);
    expect(dims).toEqual({ width: 1920, height: 1080 });
  });

  it("reads GIF dimensions from header", async () => {
    const file = makeFile(buildGif(320, 240), "test.gif", "image/gif");
    const dims = await readImageDimensionsFromFile(file);
    expect(dims).toEqual({ width: 320, height: 240 });
  });

  it("reads JPEG dimensions from SOF marker", async () => {
    const file = makeFile(buildJpeg(4032, 3024), "test.jpg", "image/jpeg");
    const dims = await readImageDimensionsFromFile(file);
    expect(dims).toEqual({ width: 4032, height: 3024 });
  });

  it("returns null for unsupported format", async () => {
    const file = makeFile(new Uint8Array([0, 0, 0, 0]), "test.bmp", "image/bmp");
    const dims = await readImageDimensionsFromFile(file);
    expect(dims).toBeNull();
  });

  it("returns null for empty file", async () => {
    const file = makeFile(new Uint8Array(0), "test.png", "image/png");
    const dims = await readImageDimensionsFromFile(file);
    expect(dims).toBeNull();
  });

  it("handles large PNG dimensions", async () => {
    const file = makeFile(buildPng(9999, 9999), "big.png", "image/png");
    const dims = await readImageDimensionsFromFile(file);
    expect(dims).toEqual({ width: 9999, height: 9999 });
  });

  it("reads JPEG dimensions with EXIF segments before SOF", async () => {
    const file = makeFile(buildJpegWithExif(4032, 3024), "photo.jpg", "image/jpeg");
    const dims = await readImageDimensionsFromFile(file);
    expect(dims).toEqual({ width: 4032, height: 3024 });
  });

  it("reads WebP VP8X dimensions", async () => {
    const file = makeFile(buildWebPVP8X(1280, 720), "test.webp", "image/webp");
    const dims = await readImageDimensionsFromFile(file);
    expect(dims).toEqual({ width: 1280, height: 720 });
  });
});
