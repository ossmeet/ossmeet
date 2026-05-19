/**
 * Read the row-changes count from a Drizzle `.run()` result.
 * D1 returns `{ meta: { changes: number } }` while better-sqlite3 returns `{ changes: number }`.
 * This helper normalises both so CAS checks work in both production and tests.
 */
export function getRunChanges(result: unknown): number {
  if (!result || typeof result !== 'object') return 0
  const r = result as Record<string, unknown>
  // better-sqlite3: { changes: number }
  if (typeof r.changes === 'number') return r.changes
  // libsql/Turso: { rowsAffected: number }
  if (typeof r.rowsAffected === 'number') return r.rowsAffected
  // D1: { meta: { changes: number } }
  const meta = r.meta
  if (meta && typeof meta === 'object') {
    const m = meta as Record<string, unknown>
    if (typeof m.changes === 'number') return m.changes
  }
  return 0
}

/**
 * Best-effort detection of transient D1/runtime errors that are safe to retry.
 * See docs/d1/best-practices/retry-queries.md for representative patterns.
 */
export function isRetryableD1Error(error: unknown): boolean {
  const msg = (error instanceof Error ? error.message : String(error)).toLowerCase()
  return (
    msg.includes("network connection lost") ||
    msg.includes("storage caused object to be reset") ||
    msg.includes("reset because its code was updated") ||
    msg.includes("temporarily unavailable") ||
    msg.includes("timed out")
  )
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Retry transient D1 failures with exponential backoff + jitter.
 */
export async function withD1Retry<T>(
  operation: () => Promise<T>,
  options?: { maxAttempts?: number; baseDelayMs?: number }
): Promise<T> {
  const maxAttempts = options?.maxAttempts ?? 4
  const baseDelayMs = options?.baseDelayMs ?? 30
  let lastError: unknown

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await operation()
    } catch (error) {
      lastError = error
      if (attempt >= maxAttempts || !isRetryableD1Error(error)) {
        throw error
      }
      const backoff = baseDelayMs * 2 ** (attempt - 1)
      const jitter = Math.floor(Math.random() * (baseDelayMs + 1))
      await sleep(backoff + jitter)
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError))
}
