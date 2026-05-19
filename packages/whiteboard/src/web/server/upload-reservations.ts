import { uploadReservations, type Database } from "@ossmeet/db";
import { and, eq, gt, lte, sql } from "drizzle-orm";

const RESERVATION_TTL_MS = 10 * 60 * 1000;

export async function reserveUploadBytes(
  db: Database,
  input: {
    principal: string;
    scope: string;
    bytes: number;
    actualUsageBytes: number;
    limitBytes: number;
  },
): Promise<string> {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + RESERVATION_TTL_MS);
  const id = crypto.randomUUID();

  // D1 does not support explicit BEGIN/COMMIT via prepared statements.
  // db.batch() sends all statements atomically in a single D1 HTTP request.
  await db.batch([
    db.delete(uploadReservations).where(lte(uploadReservations.expiresAt, now)),
    db.insert(uploadReservations).values({
      id,
      principal: input.principal,
      scope: input.scope,
      bytes: input.bytes,
      createdAt: now,
      expiresAt,
    }),
  ]);

  // After insertion, verify the principal's total active reservation is within quota.
  const [row] = await db
    .select({ total: sql<number>`coalesce(sum(${uploadReservations.bytes}), 0)` })
    .from(uploadReservations)
    .where(
      and(
        eq(uploadReservations.principal, input.principal),
        gt(uploadReservations.expiresAt, now),
      ),
    );

  const reservedBytes = Number(row?.total ?? 0);
  if (input.actualUsageBytes + reservedBytes > input.limitBytes) {
    // Remove this reservation so it doesn't count against future attempts.
    await db.delete(uploadReservations).where(eq(uploadReservations.id, id)).catch(() => {});
    throw new Error("upload_quota_exceeded");
  }

  return id;
}
