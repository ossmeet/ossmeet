import { describe, it, expect } from 'vitest'
import {
  createSpaceSchema,
  createInviteSchema,
  addMemberSchema,
  addMemberByEmailSchema,
  joinViaInviteSchema,
  updateSpaceSchema,
} from './spaces.ts'

describe('createSpaceSchema', () => {
  it('accepts valid input', () => {
    expect(createSpaceSchema.safeParse({ name: 'My Space' }).success).toBe(true)
  })

  it('accepts optional description', () => {
    expect(createSpaceSchema.safeParse({ name: 'My Space', description: 'A description' }).success).toBe(true)
  })

  it('rejects empty name', () => {
    expect(createSpaceSchema.safeParse({ name: '' }).success).toBe(false)
  })

  it('rejects whitespace-only name', () => {
    expect(createSpaceSchema.safeParse({ name: '   ' }).success).toBe(false)
  })

  it('rejects name over 200 chars', () => {
    expect(createSpaceSchema.safeParse({ name: 'a'.repeat(201) }).success).toBe(false)
  })

  it('rejects description over 1000 chars', () => {
    expect(createSpaceSchema.safeParse({ name: 'ok', description: 'a'.repeat(1001) }).success).toBe(false)
  })
})

describe('updateSpaceSchema', () => {
  it('accepts valid input with spaceId', () => {
    expect(updateSpaceSchema.safeParse({ spaceId: 'spc_1', name: 'New Name' }).success).toBe(true)
  })

  it('rejects missing spaceId', () => {
    expect(updateSpaceSchema.safeParse({ name: 'New Name' }).success).toBe(false)
  })
})

describe('createInviteSchema', () => {
  it('defaults role to member', () => {
    const result = createInviteSchema.safeParse({ spaceId: 'spc_1' })
    expect(result.success && result.data.role).toBe('member')
  })

  it('defaults expiresInHours to 24', () => {
    const result = createInviteSchema.safeParse({ spaceId: 'spc_1' })
    expect(result.success && result.data.expiresInHours).toBe(24)
  })

  it('accepts role admin', () => {
    expect(createInviteSchema.safeParse({ spaceId: 'spc_1', role: 'admin' }).success).toBe(true)
  })

  it('rejects expiresInHours over 168', () => {
    expect(createInviteSchema.safeParse({ spaceId: 'spc_1', expiresInHours: 169 }).success).toBe(false)
  })

  it('accepts expiresInHours exactly 168', () => {
    expect(createInviteSchema.safeParse({ spaceId: 'spc_1', expiresInHours: 168 }).success).toBe(true)
  })

  it('rejects maxUses of 0', () => {
    expect(createInviteSchema.safeParse({ spaceId: 'spc_1', maxUses: 0 }).success).toBe(false)
  })

  it('accepts maxUses of 1', () => {
    expect(createInviteSchema.safeParse({ spaceId: 'spc_1', maxUses: 1 }).success).toBe(true)
  })
})

describe('addMemberSchema', () => {
  it('defaults role to member', () => {
    const result = addMemberSchema.safeParse({ spaceId: 'spc_1', userId: 'usr_1' })
    expect(result.success && result.data.role).toBe('member')
  })

  it('accepts role admin', () => {
    expect(addMemberSchema.safeParse({ spaceId: 'spc_1', userId: 'usr_1', role: 'admin' }).success).toBe(true)
  })

  it('rejects role owner', () => {
    expect(addMemberSchema.safeParse({ spaceId: 'spc_1', userId: 'usr_1', role: 'owner' }).success).toBe(false)
  })
})

describe('addMemberByEmailSchema', () => {
  it('accepts valid email', () => {
    expect(addMemberByEmailSchema.safeParse({ spaceId: 'spc_1', email: 'user@example.com' }).success).toBe(true)
  })

  it('rejects invalid email', () => {
    expect(addMemberByEmailSchema.safeParse({ spaceId: 'spc_1', email: 'notanemail' }).success).toBe(false)
  })
})

describe('joinViaInviteSchema', () => {
  it('accepts a valid token', () => {
    expect(joinViaInviteSchema.safeParse({ token: 'abc123' }).success).toBe(true)
  })

  it('rejects empty token', () => {
    expect(joinViaInviteSchema.safeParse({ token: '' }).success).toBe(false)
  })
})
