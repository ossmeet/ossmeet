import { describe, it, expect } from 'vitest'
import {
  signUpSchema,
  loginSchema,
  otpVerifySchema,
  deleteAccountSchema,
  updateProfileSchema,
} from './auth.ts'

describe('signUpSchema', () => {
  const valid = { name: 'Alice', email: 'alice@example.com' }

  it('accepts valid input', () => {
    expect(signUpSchema.safeParse(valid).success).toBe(true)
  })

  it('rejects invalid email', () => {
    expect(signUpSchema.safeParse({ ...valid, email: 'notanemail' }).success).toBe(false)
  })

  it('rejects empty name', () => {
    expect(signUpSchema.safeParse({ ...valid, name: '' }).success).toBe(false)
  })

  it('rejects name over 100 chars', () => {
    expect(signUpSchema.safeParse({ ...valid, name: 'a'.repeat(101) }).success).toBe(false)
  })
})

describe('loginSchema', () => {
  it('accepts valid email', () => {
    expect(loginSchema.safeParse({ email: 'user@example.com' }).success).toBe(true)
  })

  it('rejects invalid email', () => {
    expect(loginSchema.safeParse({ email: 'bad' }).success).toBe(false)
  })

  it('rejects empty input', () => {
    expect(loginSchema.safeParse({}).success).toBe(false)
  })
})

describe('otpVerifySchema', () => {
  const valid = { email: 'user@example.com', otp: '123456' }

  it('accepts valid 6-digit OTP', () => {
    expect(otpVerifySchema.safeParse(valid).success).toBe(true)
  })

  it('rejects OTP with letters', () => {
    expect(otpVerifySchema.safeParse({ ...valid, otp: 'abc123' }).success).toBe(false)
  })

  it('rejects OTP shorter than 6 digits', () => {
    expect(otpVerifySchema.safeParse({ ...valid, otp: '12345' }).success).toBe(false)
  })

  it('rejects OTP longer than 6 digits', () => {
    expect(otpVerifySchema.safeParse({ ...valid, otp: '1234567' }).success).toBe(false)
  })

  it('accepts OTP with leading zeros', () => {
    expect(otpVerifySchema.safeParse({ ...valid, otp: '000001' }).success).toBe(true)
  })
})

describe('deleteAccountSchema', () => {
  it('accepts confirmation DELETE with valid OTP', () => {
    expect(deleteAccountSchema.safeParse({ confirmation: 'DELETE', otp: '123456' }).success).toBe(true)
  })

  it('rejects invalid OTP format', () => {
    expect(deleteAccountSchema.safeParse({ confirmation: 'DELETE', otp: 'abc123' }).success).toBe(false)
  })

  it('rejects lowercase delete', () => {
    expect(deleteAccountSchema.safeParse({ confirmation: 'delete', otp: '123456' }).success).toBe(false)
  })

  it('rejects any other confirmation string', () => {
    expect(deleteAccountSchema.safeParse({ confirmation: 'yes', otp: '123456' }).success).toBe(false)
  })
})

describe('updateProfileSchema', () => {
  it('accepts valid name', () => {
    expect(updateProfileSchema.safeParse({ name: 'Bob' }).success).toBe(true)
  })

  it('rejects empty name', () => {
    expect(updateProfileSchema.safeParse({ name: '' }).success).toBe(false)
  })

  it('rejects name over 100 chars', () => {
    expect(updateProfileSchema.safeParse({ name: 'a'.repeat(101) }).success).toBe(false)
  })
})
