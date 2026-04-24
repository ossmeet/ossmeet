import { describe, it, expect, beforeEach } from 'vitest'
import { createTestDb, type TestDb } from '@/test/db.ts'
import { resolveInviteEffectiveRole } from '../invite-logic.ts'
import type { Database } from '@ossmeet/db'
import { users, spaces, spaceMembers } from '@ossmeet/db/schema'

let db: TestDb
const getAppDb = () => db as unknown as Database

beforeEach(async () => {
  db = await createTestDb()
})

async function insertUser(id: string) {
  const now = new Date()
  await db.insert(users).values({
    id,
    name: id,
    email: `${id}@example.com`,
    normalizedEmail: `${id}@example.com`,
    image: null,
    plan: 'free',
    role: 'user',
    createdAt: now,
    updatedAt: now,
  })
}

async function insertSpace(id: string, ownerId: string) {
  const now = new Date()
  // Slug must match CHECK: lowercase a-z, 0-9, hyphen only
  const slug = `slug-${id.toLowerCase().replace(/[^a-z0-9-]/g, '-')}`
  await db.insert(spaces).values({
    id,
    name: 'Test Space',
    description: null,
    slug,
    ownerId,
    createdAt: now,
    updatedAt: now,
  })
}

async function insertMember(spaceId: string, userId: string, role: 'owner' | 'admin' | 'member') {
  await db.insert(spaceMembers).values({
    id: `mbr_${spaceId}_${userId}`,
    spaceId,
    userId,
    role,
    joinedAt: new Date(),
  })
}

describe('resolveInviteEffectiveRole', () => {
  it('returns "member" when invite role is member and creator is admin', async () => {
    await insertUser('creator')
    await insertUser('owner')
    await insertSpace('spc_1', 'owner')
    await insertMember('spc_1', 'creator', 'admin')

    const role = await resolveInviteEffectiveRole(getAppDb(), {
      role: 'member',
      spaceId: 'spc_1',
      createdById: 'creator',
    })
    expect(role).toBe('member')
  })

  it('returns "admin" when invite role is admin and creator is still admin', async () => {
    await insertUser('creator')
    await insertUser('owner')
    await insertSpace('spc_1', 'owner')
    await insertMember('spc_1', 'creator', 'admin')

    const role = await resolveInviteEffectiveRole(getAppDb(), {
      role: 'admin',
      spaceId: 'spc_1',
      createdById: 'creator',
    })
    expect(role).toBe('admin')
  })

  it('downgrades admin invite to member when creator was demoted to member', async () => {
    await insertUser('creator')
    await insertUser('owner')
    await insertSpace('spc_1', 'owner')
    await insertMember('spc_1', 'creator', 'member') // was admin when invite was created, now member

    const role = await resolveInviteEffectiveRole(getAppDb(), {
      role: 'admin',
      spaceId: 'spc_1',
      createdById: 'creator',
    })
    expect(role).toBe('member')
  })

  it('downgrades admin invite to member when creator was removed from space', async () => {
    await insertUser('creator')
    await insertUser('owner')
    await insertSpace('spc_1', 'owner')
    // creator is NOT in spaceMembers — they were removed

    const role = await resolveInviteEffectiveRole(getAppDb(), {
      role: 'admin',
      spaceId: 'spc_1',
      createdById: 'creator',
    })
    expect(role).toBe('member')
  })

  it('returns "admin" when invite role is admin and creator is owner', async () => {
    await insertUser('creator')
    await insertSpace('spc_1', 'creator')
    await insertMember('spc_1', 'creator', 'owner')

    const role = await resolveInviteEffectiveRole(getAppDb(), {
      role: 'admin',
      spaceId: 'spc_1',
      createdById: 'creator',
    })
    expect(role).toBe('admin')
  })

  it('downgrades admin invite when createdById is null', async () => {
    const adminRole = await resolveInviteEffectiveRole(getAppDb(), {
      role: 'admin',
      spaceId: 'spc_1',
      createdById: null,
    })
    expect(adminRole).toBe('member')

    const memberRole = await resolveInviteEffectiveRole(getAppDb(), {
      role: 'member',
      spaceId: 'spc_1',
      createdById: null,
    })
    expect(memberRole).toBe('member')
  })

  it('does not downgrade member invite even when creator was demoted', async () => {
    await insertUser('creator')
    await insertUser('owner')
    await insertSpace('spc_1', 'owner')
    await insertMember('spc_1', 'creator', 'member')

    const role = await resolveInviteEffectiveRole(getAppDb(), {
      role: 'member',
      spaceId: 'spc_1',
      createdById: 'creator',
    })
    expect(role).toBe('member')
  })

  it('downgrades admin invite when creator is no longer in the space (removed user)', async () => {
    await insertUser('ex_member')
    await insertUser('owner')
    await insertSpace('spc_2', 'owner')
    // ex_member was admin but is now completely removed

    const role = await resolveInviteEffectiveRole(getAppDb(), {
      role: 'admin',
      spaceId: 'spc_2',
      createdById: 'ex_member',
    })
    expect(role).toBe('member')
  })
})
