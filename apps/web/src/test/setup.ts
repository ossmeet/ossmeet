import { timingSafeEqual } from 'node:crypto'

// Shim crypto.subtle.timingSafeEqual — it exists in Cloudflare Workers but not
// in the standard Web Crypto API. Node.js exposes it on node:crypto, so we
// bridge it here so auth/crypto.ts tests work in Vitest's Node environment.
if (!('timingSafeEqual' in crypto.subtle)) {
  Object.defineProperty(crypto.subtle, 'timingSafeEqual', {
    value(
      a: ArrayBuffer | ArrayBufferView,
      b: ArrayBuffer | ArrayBufferView,
    ): boolean {
      const toBuffer = (v: ArrayBuffer | ArrayBufferView) =>
        v instanceof ArrayBuffer
          ? Buffer.from(v)
          : Buffer.from(
              (v as ArrayBufferView).buffer,
              (v as ArrayBufferView).byteOffset,
              (v as ArrayBufferView).byteLength,
            )
      return timingSafeEqual(toBuffer(a), toBuffer(b))
    },
  })
}
