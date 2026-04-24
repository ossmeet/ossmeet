import { describe, it, expect } from 'vitest'
import { livekitHttpUrl, isExpectedClosedPublishError } from './livekit-helpers.ts'

describe('livekitHttpUrl', () => {
  it('converts ws:// to http://', () => {
    expect(livekitHttpUrl('ws://lk.example.com')).toBe('http://lk.example.com')
  })

  it('converts wss:// to https://', () => {
    expect(livekitHttpUrl('wss://lk.example.com')).toBe('https://lk.example.com')
  })

  it('removes trailing slash', () => {
    expect(livekitHttpUrl('wss://lk.example.com/')).toBe('https://lk.example.com')
  })

  it('preserves port number', () => {
    expect(livekitHttpUrl('ws://localhost:7880')).toBe('http://localhost:7880')
  })

  it('preserves path', () => {
    expect(livekitHttpUrl('wss://lk.example.com/signal')).toBe('https://lk.example.com/signal')
  })
})

describe('isExpectedClosedPublishError', () => {
  it('returns true for PC manager is closed', () => {
    expect(isExpectedClosedPublishError(new Error('PC Manager is closed'))).toBe(true)
  })

  it('returns true for UnexpectedConnectionState (case-insensitive)', () => {
    expect(isExpectedClosedPublishError(new Error('UnexpectedConnectionState occurred'))).toBe(true)
  })

  it('returns true for not connected', () => {
    expect(isExpectedClosedPublishError(new Error('not connected'))).toBe(true)
  })

  it('returns false for unrelated error message', () => {
    expect(isExpectedClosedPublishError(new Error('network timeout'))).toBe(false)
  })

  it('returns false for non-Error values', () => {
    expect(isExpectedClosedPublishError('string error')).toBe(false)
    expect(isExpectedClosedPublishError(null)).toBe(false)
    expect(isExpectedClosedPublishError(42)).toBe(false)
  })
})
