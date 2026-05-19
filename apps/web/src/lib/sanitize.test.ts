import { describe, it, expect } from 'vitest'
import { sanitizeDisplayName } from './sanitize.ts'

describe('sanitizeDisplayName', () => {
  it('passes through a safe string unchanged', () => {
    expect(sanitizeDisplayName('Alice')).toBe('Alice')
  })

  it('strips HTML tags', () => {
    expect(sanitizeDisplayName('<script>alert(1)</script>')).toBe('alert(1)')
    expect(sanitizeDisplayName('<b>bold</b>')).toBe('bold')
  })

  it('strips bidi control characters', () => {
    expect(sanitizeDisplayName('Alice\u202EevildroP')).toBe('AliceevildroP')
    expect(sanitizeDisplayName('Bob\u200BCarol')).toBe('BobCarol')
    expect(sanitizeDisplayName('\u2066hidden\u2069')).toBe('hidden')
  })

  it('strips ASCII control characters', () => {
    expect(sanitizeDisplayName('Alice\x00Bob')).toBe('AliceBob')
    expect(sanitizeDisplayName('Tab\x09here')).toBe('Tabhere')
    expect(sanitizeDisplayName('\x1FAlice')).toBe('Alice')
  })

  it('normalizes multiple spaces to one', () => {
    expect(sanitizeDisplayName('Alice   Bob')).toBe('Alice Bob')
    expect(sanitizeDisplayName('  Alice  ')).toBe('Alice')
  })

  it('trims leading and trailing whitespace', () => {
    expect(sanitizeDisplayName('  Alice  ')).toBe('Alice')
  })

  it('truncates to 100 characters', () => {
    const long = 'a'.repeat(150)
    expect(sanitizeDisplayName(long).length).toBe(100)
  })

  it('returns default fallback for empty string', () => {
    expect(sanitizeDisplayName('')).toBe('Guest')
  })

  it('returns custom fallback for empty string', () => {
    expect(sanitizeDisplayName('', 'Anonymous')).toBe('Anonymous')
  })

  it('returns fallback when result is empty after stripping', () => {
    expect(sanitizeDisplayName('<b></b>')).toBe('Guest')
  })
})
