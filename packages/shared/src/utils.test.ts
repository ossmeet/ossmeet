import { describe, it, expect } from 'vitest'
import { escapeHtml, generateMeetingCode, generateId } from './utils.ts'
import { ID_PREFIX } from './constants.ts'
import { MEETING_CODE_REGEX } from './constants.ts'

describe('escapeHtml', () => {
  it('escapes ampersand', () => {
    expect(escapeHtml('a & b')).toBe('a &amp; b')
  })

  it('escapes less-than and greater-than', () => {
    expect(escapeHtml('<b>bold</b>')).toBe('&lt;b&gt;bold&lt;/b&gt;')
  })

  it('escapes double quote', () => {
    expect(escapeHtml('"hello"')).toBe('&quot;hello&quot;')
  })

  it("escapes single quote", () => {
    expect(escapeHtml("it's")).toBe("it&#039;s")
  })

  it('leaves safe strings unchanged', () => {
    expect(escapeHtml('hello world')).toBe('hello world')
  })

  it('escapes all special chars in one string', () => {
    expect(escapeHtml('<a href="x">it\'s & fun</a>')).toBe(
      '&lt;a href=&quot;x&quot;&gt;it&#039;s &amp; fun&lt;/a&gt;',
    )
  })
})

describe('generateMeetingCode', () => {
  it('matches the expected format', () => {
    for (let i = 0; i < 20; i++) {
      expect(generateMeetingCode()).toMatch(MEETING_CODE_REGEX)
    }
  })

  it('generates distinct codes', () => {
    const codes = new Set(Array.from({ length: 50 }, () => generateMeetingCode()))
    expect(codes.size).toBeGreaterThan(45)
  })
})

describe('generateId', () => {
  it('starts with the correct prefix for each key', () => {
    const prefixKeys = Object.keys(ID_PREFIX) as (keyof typeof ID_PREFIX)[]
    for (const key of prefixKeys) {
      const id = generateId(key)
      expect(id.startsWith(ID_PREFIX[key])).toBe(true)
    }
  })

  it('generates unique ids', () => {
    const ids = new Set(Array.from({ length: 20 }, () => generateId('USER')))
    expect(ids.size).toBe(20)
  })
})
