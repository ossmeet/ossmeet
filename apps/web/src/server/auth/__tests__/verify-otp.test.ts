import { describe, it, expect, beforeEach } from 'vitest'
import { createTestDb, type TestDb } from '@/test/db.ts'
import { verifyOtpWithAttempts } from '../signup.ts'
import { verifications } from '@ossmeet/db/schema'
import { eq } from 'drizzle-orm'

let db: TestDb

beforeEach(async () => {
  db = await createTestDb()
})

/** Insert a bare verification record and return it. */
async function insertVerification(opts: {
  id?: string
  identifier?: string
  value: string
  data?: string | null
  expiresOffsetMs?: number
}) {
  const id = opts.id ?? crypto.randomUUID()
  const now = new Date()
  const expiresAt = new Date(now.getTime() + (opts.expiresOffsetMs ?? 600_000))
  await db.insert(verifications).values({
    id,
    type: "otp_signup" as const,
    identifier: opts.identifier ?? `signup:test@example.com`,
    value: opts.value,
    data: opts.data ?? null,
    expiresAt,
    updatedAt: now,
  })
  const row = await db.query.verifications.findFirst({ where: eq(verifications.id, id) })
  return row!
}

describe('verifyOtpWithAttempts', () => {
  it('passes when the OTP hash is correct', async () => {
    const v = await insertVerification({ value: 'abc123hash' })
    await expect(verifyOtpWithAttempts(db, v, 'abc123hash')).resolves.toBeUndefined()
  })

  it('does not modify the DB when OTP is correct', async () => {
    const v = await insertVerification({ value: 'goodhash', data: JSON.stringify({ name: 'Alice' }) })
    await verifyOtpWithAttempts(db, v, 'goodhash')
    const after = await db.query.verifications.findFirst({ where: eq(verifications.id, v.id) })
    expect(after).toBeDefined()
    expect(JSON.parse(after!.data!).name).toBe('Alice')
  })

  it('throws on wrong OTP hash', async () => {
    const v = await insertVerification({ value: 'correcthash' })
    await expect(verifyOtpWithAttempts(db, v, 'wronghash')).rejects.toThrow('Invalid or expired OTP')
  })

  it('increments _attempts on wrong OTP', async () => {
    const v = await insertVerification({ value: 'correcthash', data: null })
    await expect(verifyOtpWithAttempts(db, v, 'wronghash')).rejects.toThrow()
    const after = await db.query.verifications.findFirst({ where: eq(verifications.id, v.id) })
    expect(JSON.parse(after!.data!)._attempts).toBe(1)
  })

  it('increments _attempts correctly when data already has attempts', async () => {
    const v = await insertVerification({
      value: 'correcthash',
      data: JSON.stringify({ _attempts: 2, name: 'Alice' }),
    })
    await expect(verifyOtpWithAttempts(db, v, 'wronghash')).rejects.toThrow()
    const after = await db.query.verifications.findFirst({ where: eq(verifications.id, v.id) })
    expect(JSON.parse(after!.data!)._attempts).toBe(3)
  })

  it('treats null data as 0 attempts (no lockout on first wrong attempt)', async () => {
    const v = await insertVerification({ value: 'correcthash', data: null })
    // Should throw wrong-OTP, not "too many attempts"
    await expect(verifyOtpWithAttempts(db, v, 'wronghash')).rejects.toThrow('Invalid or expired OTP')
  })

  it('rejects malformed JSON verification payloads at the schema level', async () => {
    await expect(insertVerification({ value: 'correcthash', data: 'not-valid-json' })).rejects.toBeDefined()
  })

  it('allows a 5th attempt when _attempts is 4', async () => {
    const v = await insertVerification({
      value: 'correcthash',
      data: JSON.stringify({ _attempts: 4 }),
    })
    // 4 attempts already → 5th attempt is still allowed (limit is AT 5, not before)
    await expect(verifyOtpWithAttempts(db, v, 'wronghash')).rejects.toThrow('Invalid or expired OTP')
  })

  it('locks out and deletes record when _attempts is already 5', async () => {
    const v = await insertVerification({
      value: 'correcthash',
      data: JSON.stringify({ _attempts: 5 }),
    })
    await expect(verifyOtpWithAttempts(db, v, 'correcthash')).rejects.toThrow('Too many failed attempts')
    // Record should be deleted
    const after = await db.query.verifications.findFirst({ where: eq(verifications.id, v.id) })
    expect(after).toBeUndefined()
  })

  it('locks out even with correct hash when attempts >= 5', async () => {
    const v = await insertVerification({
      value: 'correcthash',
      data: JSON.stringify({ _attempts: 5 }),
    })
    // Even the right hash is rejected when already at lockout
    await expect(verifyOtpWithAttempts(db, v, 'correcthash')).rejects.toThrow('Too many failed attempts')
  })

  it('preserves non-attempt fields in data on wrong OTP', async () => {
    const v = await insertVerification({
      value: 'correcthash',
      data: JSON.stringify({ name: 'Alice', email: 'alice@example.com', _attempts: 1 }),
    })
    await expect(verifyOtpWithAttempts(db, v, 'wronghash')).rejects.toThrow()
    const after = await db.query.verifications.findFirst({ where: eq(verifications.id, v.id) })
    const parsed = JSON.parse(after!.data!)
    expect(parsed.name).toBe('Alice')
    expect(parsed.email).toBe('alice@example.com')
    expect(parsed._attempts).toBe(2)
  })
})
