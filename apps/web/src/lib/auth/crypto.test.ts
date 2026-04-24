import { describe, it, expect } from 'vitest'
import {
  generateOTP,
  hashSessionToken,
  generateSessionToken,
  timingSafeCompareHex,
} from './crypto.ts'

describe('generateOTP', () => {
  it('returns a 6-character string', () => {
    expect(generateOTP()).toHaveLength(6)
  })

  it('contains only digits', () => {
    for (let i = 0; i < 20; i++) {
      expect(generateOTP()).toMatch(/^\d{6}$/)
    }
  })

  it('generates distinct values', () => {
    const otps = new Set(Array.from({ length: 50 }, () => generateOTP()))
    expect(otps.size).toBeGreaterThan(40)
  })
})

describe('hashSessionToken', () => {
  it('is deterministic for the same input', async () => {
    const h1 = await hashSessionToken('my-token')
    const h2 = await hashSessionToken('my-token')
    expect(h1).toBe(h2)
  })

  it('produces different hashes for different inputs', async () => {
    const h1 = await hashSessionToken('token-a')
    const h2 = await hashSessionToken('token-b')
    expect(h1).not.toBe(h2)
  })

  it('returns a 64-char lowercase hex string (SHA-256)', async () => {
    const hash = await hashSessionToken('test')
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('generateSessionToken', () => {
  it('returns a 64-char lowercase hex string', () => {
    const token = generateSessionToken()
    expect(token).toMatch(/^[0-9a-f]{64}$/)
  })

  it('generates unique tokens', () => {
    const tokens = new Set(Array.from({ length: 20 }, () => generateSessionToken()))
    expect(tokens.size).toBe(20)
  })
})

describe('timingSafeCompareHex', () => {
  it('returns true for identical strings', () => {
    expect(timingSafeCompareHex('abc123', 'abc123')).toBe(true)
  })

  it('returns false for different strings of same length', () => {
    expect(timingSafeCompareHex('abc123', 'abc124')).toBe(false)
  })

  it('returns false for strings of different length', () => {
    expect(timingSafeCompareHex('abc', 'abcd')).toBe(false)
  })

  it('returns false for empty vs non-empty', () => {
    expect(timingSafeCompareHex('', 'a')).toBe(false)
  })

  it('returns true for two empty strings', () => {
    expect(timingSafeCompareHex('', '')).toBe(true)
  })
})
