import { createClient } from '@libsql/client'
import { drizzle } from 'drizzle-orm/libsql'
import type { Database } from '@ossmeet/db'
import * as schema from '@ossmeet/db/schema'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join, dirname } from 'node:path'

const MIGRATIONS_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../packages/db/drizzle/migrations',
)

const MIGRATION_FILES = readdirSync(MIGRATIONS_DIR)
  .filter((file) => file.endsWith('.sql'))
  .sort((a, b) => a.localeCompare(b))

/**
 * Create an in-memory SQLite database with the full application schema applied.
 * Uses @libsql/client so tests run in Node without Cloudflare bindings.
 * Each call returns a fresh isolated database — safe to use in parallel tests.
 */
export async function createTestDb(): Promise<Database> {
  const client = createClient({ url: ':memory:' })
  await client.execute('PRAGMA foreign_keys = ON')

  // Apply migrations in order
  for (const file of MIGRATION_FILES) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf-8')
    const statements = sql
      .split('--> statement-breakpoint')
      .map((s) => s.trim())
      .filter(Boolean)
    for (const stmt of statements) {
      await client.execute(stmt)
    }
  }

  return drizzle(client, { schema }) as unknown as Database
}

export type TestDb = Database
