import { describe, it, expect } from 'vitest'
import { meetingAssetKey, spaceAssetKey, whiteboardSnapshotKey } from './r2-key.ts'

describe('meetingAssetKey', () => {
  it('constructs the correct path', () => {
    expect(meetingAssetKey('mtg_123', 'recording.mp4')).toBe('sessions/mtg_123/recording.mp4')
  })

  it('preserves subdirectory structure in filename', () => {
    expect(meetingAssetKey('mtg_1', 'sub/file.pdf')).toBe('sessions/mtg_1/sub/file.pdf')
  })
})

describe('spaceAssetKey', () => {
  it('constructs the correct path', () => {
    expect(spaceAssetKey('spc_456', 'document.pdf')).toBe('spaces/spc_456/document.pdf')
  })
})

describe('whiteboardSnapshotKey', () => {
  it('constructs the correct path', () => {
    expect(whiteboardSnapshotKey('mtg_789')).toBe('whiteboards/mtg_789/whiteboard-snapshot.png')
  })
})
