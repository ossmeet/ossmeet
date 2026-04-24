import { describe, it, expect } from 'vitest'
import { getPlanLimits, PLAN_LIMITS } from './plan-limits.ts'

describe('PLAN_LIMITS', () => {
  it('has entries for all 3 plans', () => {
    expect(PLAN_LIMITS).toHaveProperty('free')
    expect(PLAN_LIMITS).toHaveProperty('pro')
    expect(PLAN_LIMITS).toHaveProperty('org')
  })
})

describe('getPlanLimits', () => {
  it('returns correct free plan limits', () => {
    const limits = getPlanLimits('free')
    expect(limits.maxParticipants).toBe(100)
    expect(limits.maxConcurrentMeetings).toBe(1)
    expect(limits.maxMeetingDurationMinutes).toBe(90)
    expect(limits.maxSpaces).toBe(1)
    expect(limits.maxStorageBytes).toBe(1 * 1024 * 1024 * 1024)
    expect(limits.recordingEnabled).toBe(false)
    expect(limits.pdfExportEnabled).toBe(true)
    expect(limits.customSubdomain).toBe(false)
  })

  it('returns correct pro plan limits', () => {
    const limits = getPlanLimits('pro')
    expect(limits.maxParticipants).toBe(500)
    expect(limits.maxConcurrentMeetings).toBe(5)
    expect(limits.maxMeetingDurationMinutes).toBeNull()
    expect(limits.maxSpaces).toBeNull()
    expect(limits.maxStorageBytes).toBe(50 * 1024 * 1024 * 1024)
    expect(limits.recordingEnabled).toBe(true)
  })

  it('returns correct org plan limits', () => {
    const limits = getPlanLimits('org')
    expect(limits.maxParticipants).toBeNull()
    expect(limits.maxConcurrentMeetings).toBeNull()
    expect(limits.maxMeetingDurationMinutes).toBeNull()
    expect(limits.maxSpaces).toBeNull()
    expect(limits.maxStorageBytes).toBeNull()
    expect(limits.recordingEnabled).toBe(true)
    expect(limits.customSubdomain).toBe(true)
    expect(limits.brandedExperience).toBe(true)
    expect(limits.adminDashboard).toBe(true)
  })

  it('free plan has recording disabled', () => {
    expect(getPlanLimits('free').recordingEnabled).toBe(false)
  })

  it('pro and org plans have recording enabled', () => {
    expect(getPlanLimits('pro').recordingEnabled).toBe(true)
    expect(getPlanLimits('org').recordingEnabled).toBe(true)
  })

  it('all plans have AI assistant enabled', () => {
    expect(getPlanLimits('free').aiAssistantEnabled).toBe(true)
    expect(getPlanLimits('pro').aiAssistantEnabled).toBe(true)
    expect(getPlanLimits('org').aiAssistantEnabled).toBe(true)
  })
})
