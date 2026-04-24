import { describe, it, expect } from 'vitest'
import {
  joinMeetingSchema,
  saveWhiteboardSnapshotSchema,
  saveSessionAssetSchema,
  toggleRecordingSchema,
  createMeetingSchema,
} from './meeting.ts'

describe('joinMeetingSchema', () => {
  it('accepts a standard random code', () => {
    expect(joinMeetingSchema.safeParse({ code: 'abc-defg-hij' }).success).toBe(true)
  })

  it('rejects uppercase code', () => {
    expect(joinMeetingSchema.safeParse({ code: 'ABC-DEFG-HIJ' }).success).toBe(false)
  })

  it('rejects wrong segment lengths', () => {
    expect(joinMeetingSchema.safeParse({ code: 'ab-defg-hij' }).success).toBe(false)
    expect(joinMeetingSchema.safeParse({ code: 'abc-def-hij' }).success).toBe(false)
    expect(joinMeetingSchema.safeParse({ code: 'abc-defg-hi' }).success).toBe(false)
  })

  it('rejects code with numbers', () => {
    expect(joinMeetingSchema.safeParse({ code: 'abc-1234-hij' }).success).toBe(false)
  })

  it('rejects code with special characters', () => {
    expect(joinMeetingSchema.safeParse({ code: 'abc_defg_hij' }).success).toBe(false)
  })

  it('accepts optional displayName', () => {
    expect(joinMeetingSchema.safeParse({ code: 'abc-defg-hij', displayName: 'Alice' }).success).toBe(true)
  })
})

describe('saveWhiteboardSnapshotSchema', () => {
  it('accepts a valid whiteboards/ r2Key', () => {
    expect(
      saveWhiteboardSnapshotSchema.safeParse({
        sessionId: 'msn_1',
        r2Key: 'whiteboards/msn_1/snapshot.png',
      }).success,
    ).toBe(true)
  })

  it('rejects r2Key with wrong prefix', () => {
    expect(
      saveWhiteboardSnapshotSchema.safeParse({
        sessionId: 'msn_1',
        r2Key: 'uploads/msn_1/snapshot.png',
      }).success,
    ).toBe(false)
  })

  it('rejects r2Key containing ..', () => {
    expect(
      saveWhiteboardSnapshotSchema.safeParse({
        sessionId: 'msn_1',
        r2Key: 'whiteboards/../etc/passwd',
      }).success,
    ).toBe(false)
  })
})

describe('saveSessionAssetSchema', () => {
  const base = {
    spaceId: 'spc_1',
    type: 'pdf' as const,
    filename: 'file.pdf',
    mimeType: 'application/pdf',
    size: 1024,
  }

  it('accepts uploads/ prefix', () => {
    expect(
      saveSessionAssetSchema.safeParse({ ...base, r2Key: 'uploads/user_1/file.pdf' }).success,
    ).toBe(true)
  })

  it('accepts spaces/ prefix', () => {
    expect(
      saveSessionAssetSchema.safeParse({ ...base, r2Key: 'spaces/spc_1/file.pdf' }).success,
    ).toBe(true)
  })

  it('accepts recordings/ prefix', () => {
    expect(
      saveSessionAssetSchema.safeParse({
        ...base,
        sessionId: 'msn_1',
        r2Key: 'recordings/msn_1/video.mp4',
        type: 'recording',
        mimeType: 'video/mp4',
      }).success,
    ).toBe(true)
  })

  it('accepts whiteboards/ prefix', () => {
    expect(
      saveSessionAssetSchema.safeParse({
        ...base,
        sessionId: 'msn_1',
        r2Key: 'whiteboards/msn_1/snap.png',
        type: 'whiteboard_snapshot',
        mimeType: 'image/png',
      }).success,
    ).toBe(true)
  })

  it('accepts whiteboard state prefix', () => {
    expect(
      saveSessionAssetSchema.safeParse({
        ...base,
        sessionId: 'msn_1',
        r2Key: 'whiteboard/msn_1/snapshot.json',
        type: 'whiteboard_state',
        filename: 'snapshot.json',
        mimeType: 'application/json',
      }).success,
    ).toBe(true)
  })

  it('accepts whiteboard pdf prefix', () => {
    expect(
      saveSessionAssetSchema.safeParse({
        ...base,
        sessionId: 'msn_1',
        r2Key: 'whiteboard/msn_1/export.pdf',
        type: 'whiteboard_pdf',
        mimeType: 'application/pdf',
      }).success,
    ).toBe(true)
  })

  it('rejects meeting-bound asset types without sessionId', () => {
    expect(
      saveSessionAssetSchema.safeParse({
        ...base,
        r2Key: 'recordings/msn_1/video.mp4',
        type: 'recording',
        mimeType: 'video/mp4',
      }).success,
    ).toBe(false)
  })

  it('rejects unknown prefix', () => {
    expect(
      saveSessionAssetSchema.safeParse({ ...base, r2Key: 'private/secret.pdf' }).success,
    ).toBe(false)
  })

  it('rejects r2Key containing ..', () => {
    expect(
      saveSessionAssetSchema.safeParse({ ...base, r2Key: 'uploads/../etc/passwd' }).success,
    ).toBe(false)
  })

  it('rejects negative size', () => {
    expect(
      saveSessionAssetSchema.safeParse({ ...base, r2Key: 'uploads/x/y.pdf', size: -1 }).success,
    ).toBe(false)
  })
})

describe('toggleRecordingSchema', () => {
  it('accepts start action', () => {
    expect(toggleRecordingSchema.safeParse({ sessionId: 'msn_1', action: 'start' }).success).toBe(true)
  })

  it('accepts stop action', () => {
    expect(toggleRecordingSchema.safeParse({ sessionId: 'msn_1', action: 'stop', egressId: 'eg_1' }).success).toBe(true)
  })

  it('rejects unknown action', () => {
    expect(toggleRecordingSchema.safeParse({ sessionId: 'msn_1', action: 'pause' }).success).toBe(false)
  })
})

describe('createMeetingSchema', () => {
  it('accepts empty input (all optional)', () => {
    expect(createMeetingSchema.safeParse({}).success).toBe(true)
  })

  it('defaults allowGuests to false', () => {
    const result = createMeetingSchema.safeParse({})
    expect(result.success && result.data.allowGuests).toBe(false)
  })

  it('defaults recordingEnabled to false', () => {
    const result = createMeetingSchema.safeParse({})
    expect(result.success && result.data.recordingEnabled).toBe(false)
  })

  it('rejects title over 200 chars', () => {
    expect(createMeetingSchema.safeParse({ title: 'a'.repeat(201) }).success).toBe(false)
  })
})
