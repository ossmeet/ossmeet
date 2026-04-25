import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { meetingArtifacts, users, sessions, spaces, meetingSessions, rooms, spaceAssets, verifications } from "@ossmeet/db/schema";
import { hashSessionToken, hashOtp, generateOTP } from "@/lib/auth/crypto";
import {
  updateProfileSchema,
  revokeSessionSchema,
  deleteAccountSchema,
  requestAccountDeletionSchema,
  Errors,
  OTP_EXPIRY_MS,
  chunkArray,
  d1MaxItemsPerStatement,
} from "@ossmeet/shared";
import type { PlanType } from "@ossmeet/shared";
import { eq, and, gte, inArray, lt } from "drizzle-orm";
import { logInfo, logWarn, logError } from "@/lib/logger";
import { sendEmail, buildOtpEmail } from "@/lib/email";
import {
  getSessionIdsFromCookie,
  createCookieString,
  enforceIpRateLimit,
  appendCookies,
} from "./helpers";
import { withD1Retry } from "@/lib/db-utils";
import { authMiddleware } from "../middleware";
import { finalizeMeetingsEnd } from "../meetings/finalize";
import { terminateMeetingRoom } from "../meetings/leave-end.server";
import { verifyOtpWithAttempts } from "./signup";

const ROOM_ACTIVE_LOOKUP_CHUNK_SIZE = d1MaxItemsPerStatement(1, 1);

function maskIp(ip: string): string {
  if (ip.includes(":")) {
    // IPv6: show first 4 segments
    const parts = ip.split(":");
    return parts.slice(0, 4).join(":") + ":***";
  }
  // IPv4: show first 2 octets
  const parts = ip.split(".");
  return parts.slice(0, 2).join(".") + ".*.*";
}

export const updateProfile = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator(updateProfileSchema)
  .handler(async ({ data, context: { user, env: _env, db } }) => {

    await withD1Retry(() =>
      db
        .update(users)
        .set({ name: data.name.trim(), updatedAt: new Date() })
        .where(eq(users.id, user.id)),
    );

    return { success: true, name: data.name.trim() };
  });

export const listSessions = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context: { user: currentUser, env: _env, db } }) => {
    const request = getRequest();

    // Get current session's token hash to mark it
    const cookie = request.headers.get("Cookie");
    const sessionTokens = Array.from(new Set(getSessionIdsFromCookie(cookie)));
    const currentTokenHashes = await Promise.all(
      sessionTokens.map((t) => hashSessionToken(t))
    );

    const userSessions = await db.query.sessions.findMany({
      where: and(
        eq(sessions.userId, currentUser.id),
        gte(sessions.expiresAt, new Date()),
        gte(sessions.absoluteExpiresAt, new Date())
      ),
      columns: {
        id: true,
        tokenHash: true,
        ipAddress: true,
        userAgent: true,
        createdAt: true,
      },
      orderBy: (s, { desc }) => [desc(s.createdAt)],
    });

    return userSessions.map((s) => ({
      id: s.id,
      ipAddress: s.ipAddress ? maskIp(s.ipAddress) : null,
      userAgent: s.userAgent,
      createdAt: s.createdAt,
      isCurrent: currentTokenHashes.includes(s.tokenHash),
    }));
  }
);

export const revokeSession = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator(revokeSessionSchema)
  .handler(async ({ data, context: { user: currentUser, env, db } }) => {
    const request = getRequest();

    await enforceIpRateLimit(env, "revoke-session");

    // Ensure the session belongs to the current user
    const session = await db.query.sessions.findFirst({
      where: and(
        eq(sessions.id, data.sessionId),
        eq(sessions.userId, currentUser.id)
      ),
      columns: { id: true, tokenHash: true },
    });

    if (!session) {
      throw Errors.VALIDATION("Session not found.");
    }

    // Check if this is the current session
    const cookie = request.headers.get("Cookie");
    const sessionTokens = Array.from(new Set(getSessionIdsFromCookie(cookie)));
    const currentTokenHashes = await Promise.all(
      sessionTokens.map((t) => hashSessionToken(t))
    );
    const isCurrentSession = currentTokenHashes.includes(session.tokenHash);

    // Delete the session
    await withD1Retry(() =>
      db.delete(sessions).where(eq(sessions.id, data.sessionId)),
    );

    // If revoking current session, clear the cookie
    if (isCurrentSession) {
      appendCookies([
        createCookieString("session", "", 0, {
          appUrl: env.APP_URL,
          environment: env.ENVIRONMENT,
        }),
      ]);
    }

    return { success: true, wasCurrentSession: isCurrentSession };
  });

export const revokeAllOtherSessions = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context: { user: currentUser, env, db } }) => {
    const request = getRequest();

    await enforceIpRateLimit(env, "revoke-all-sessions");

    // Get current session token hash
    const cookie = request.headers.get("Cookie");
    const sessionTokens = Array.from(new Set(getSessionIdsFromCookie(cookie)));
    const currentTokenHashes = await Promise.all(
      sessionTokens.map((t) => hashSessionToken(t))
    );

    // Get all user sessions
    const allSessions = await db
      .select({ id: sessions.id, tokenHash: sessions.tokenHash, previousTokenHash: sessions.previousTokenHash })
      .from(sessions)
      .where(eq(sessions.userId, currentUser.id));

    // Delete all sessions except the current one
    const toDelete = allSessions
      .filter((s) =>
        !currentTokenHashes.includes(s.tokenHash) &&
        !(s.previousTokenHash && currentTokenHashes.includes(s.previousTokenHash))
      )
      .map((s) => s.id);

    if (toDelete.length > 0) {
      for (const chunk of chunkArray(toDelete, d1MaxItemsPerStatement())) {
        await db.delete(sessions).where(inArray(sessions.id, chunk));
      }
    }

    return { success: true, revokedCount: toDelete.length };
  }
);

/**
 * Request an account deletion confirmation email for OAuth-only accounts.
 * Sends a one-time token to the account email address that must be provided
 * in the subsequent deleteAccount call.
 */
export const requestAccountDeletion = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator(requestAccountDeletionSchema)
  .handler(async ({ context: { user: currentUser, env, db } }) => {

    await enforceIpRateLimit(env, "request-delete-account");

    const userRecord = await db.query.users.findFirst({
      where: eq(users.id, currentUser.id),
      columns: { email: true },
    });

    const otp = generateOTP();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + OTP_EXPIRY_MS);
    const identifier = `delete-account:${currentUser.id}`;
    const otpHash = await hashOtp(otp, currentUser.id, env.AUTH_SECRET);

    const cooldownThreshold = new Date(now.getTime() - 60_000);
    const insertResult = await db
      .insert(verifications)
      .values({
        id: crypto.randomUUID(),
        type: "otp_account_delete" as const,
        identifier,
        value: otpHash,
        data: null,
        expiresAt,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [verifications.type, verifications.identifier],
        set: { value: otpHash, data: null, expiresAt, updatedAt: now },
        setWhere: lt(verifications.updatedAt, cooldownThreshold),
      })
      .run();

    const changes = (insertResult as { meta?: { changes?: number } }).meta?.changes ?? 0;
    if (changes === 0) {
      // Cooldown active — do not re-send
      return { success: true };
    }

    if (env.RESEND_API_KEY && userRecord?.email) {
      const { subject, html } = buildOtpEmail(otp, "delete-account");
      await sendEmail(env.RESEND_API_KEY, { to: userRecord.email, subject, html }).catch((err) => {
        logWarn("[requestAccountDeletion] Failed to send OTP email:", err);
      });
    }

    return { success: true };
  });

export const deleteAccount = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator(deleteAccountSchema)
  .handler(async ({ data, context: { user: currentUser, env, db } }) => {

    await enforceIpRateLimit(env, "delete-account");

    // Re-verify credentials before allowing irreversible account deletion.
    // A valid session alone is insufficient — a hijacked session must not be able to delete the account.
    const identifier = `delete-account:${currentUser.id}`;
    const tokenHash = await hashOtp(data.otp, currentUser.id, env.AUTH_SECRET);
    const verification = await db.query.verifications.findFirst({
      where: and(
        eq(verifications.type, "otp_account_delete"),
        eq(verifications.identifier, identifier),
        gte(verifications.expiresAt, new Date())
      ),
    });
    if (!verification) throw Errors.UNAUTHORIZED();
    await verifyOtpWithAttempts(db, verification, tokenHash).catch((err) => {
      if (err instanceof Error) throw err;
      throw Errors.UNAUTHORIZED();
    });
    await db.delete(verifications).where(
      and(eq(verifications.type, "otp_account_delete"), eq(verifications.identifier, identifier))
    ).catch((err) => {
      logWarn("[deleteAccount] Failed to clean up account-delete OTP verification:", err);
    });

    // Check for owned spaces (onDelete: "restrict")
    const ownedSpaces = await db.query.spaces.findMany({
      where: eq(spaces.ownerId, currentUser.id),
      columns: { id: true, name: true },
      limit: 5,
    });

    if (ownedSpaces.length > 0) {
      // Sanitize user-controlled space names before embedding in error message
      const escapeHtml = (s: string) =>
        s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] ?? c));
      const spaceNames = ownedSpaces.map((s) => escapeHtml(s.name)).join(", ");
      throw Errors.VALIDATION(
        `You own ${ownedSpaces.length} space(s): ${spaceNames}. Please delete or transfer ownership before deleting your account.`
      );
    }

    // Check for active hosted meetingSessions (onDelete: "restrict")
    const activeMeetings = await db.query.meetingSessions.findMany({
      where: and(
        eq(meetingSessions.hostId, currentUser.id),
        eq(meetingSessions.status, "active")
      ),
      columns: { id: true },
      limit: 5,
    });

    if (activeMeetings.length > 0) {
      throw Errors.VALIDATION(
        `You have ${activeMeetings.length} active meeting(s). Please end all meetingSessions before deleting your account.`
      );
    }

    // Clean up owned rooms. Room deletion cascades to ended sessions and their data.
    const userRooms = await db.query.rooms.findMany({
      where: eq(rooms.hostId, currentUser.id),
      columns: { id: true },
    });

    if (userRooms.length > 0) {
      const roomIds = userRooms.map((room) => room.id);

      // End active sessions under these rooms.
      // Chunk SELECT and all subsequent writes to respect D1's 100-param limit.
      const activeRoomSessions: { id: string; activeEgressId: string | null }[] = [];
      for (const chunk of chunkArray(roomIds, ROOM_ACTIVE_LOOKUP_CHUNK_SIZE)) {
        const rows = await db
          .select({ id: meetingSessions.id, activeEgressId: meetingSessions.activeEgressId })
          .from(meetingSessions)
          .where(and(inArray(meetingSessions.roomId, chunk), eq(meetingSessions.status, "active")));
        activeRoomSessions.push(...rows);
      }

      if (activeRoomSessions.length > 0) {
        const now2 = new Date();
        await finalizeMeetingsEnd(db, {
          meetingIds: activeRoomSessions.map((m) => m.id),
          hostPlan: ((currentUser.plan as PlanType) ?? "free"),
          now: now2,
          onlyActive: true,
        });
        await Promise.allSettled(
          activeRoomSessions.map((meeting) =>
            terminateMeetingRoom(env, meeting.id, meeting.activeEgressId).catch((err) => {
              logWarn(`[deleteAccount] Failed to terminate room for meeting ${meeting.id}:`, err);
            }),
          ),
        );
      }

      for (const chunk of chunkArray(roomIds, 100)) {
        await db.delete(rooms).where(inArray(rooms.id, chunk));
      }
    }

    // Delete ended meetingSessions where user is host.
    // meetingSessions.hostId has onDelete: "restrict", so ended meetingSessions block user deletion.
    // Active meetingSessions were already handled above; ended ones are safe to delete entirely.
    await db.delete(meetingSessions)
      .where(and(eq(meetingSessions.hostId, currentUser.id), eq(meetingSessions.status, "ended")));

    // Clean up R2 objects before deleting the user row.
    // Asset rows linked to this user may not cascade on uploadedById,
    // so we delete R2 objects and their DB records explicitly.
    try {
      const [uploadedAssets, meetingGeneratedAssets] = await db.batch([
        db
          .select({ id: spaceAssets.id, r2Key: spaceAssets.r2Key })
          .from(spaceAssets)
          .where(eq(spaceAssets.uploadedById, currentUser.id)),
        db
          .select({ id: meetingArtifacts.id, r2Key: meetingArtifacts.r2Key })
          .from(meetingArtifacts)
          .where(eq(meetingArtifacts.uploadedById, currentUser.id)),
      ]);
      const userAssets = [...uploadedAssets, ...meetingGeneratedAssets];

      if (userAssets.length > 0) {
        await Promise.allSettled(
          userAssets.map((asset) =>
            env.R2_BUCKET.delete(asset.r2Key).catch((err: unknown) => {
              logWarn(`[deleteAccount] Failed to delete R2 object ${asset.r2Key}:`, err);
            })
            )
        );
        await db.delete(meetingArtifacts).where(eq(meetingArtifacts.uploadedById, currentUser.id));
        await db.delete(spaceAssets).where(eq(spaceAssets.uploadedById, currentUser.id));
      }

      // Clean up untracked user uploads under the uploads/{userId}/ prefix.
      // Use cursor-based pagination to handle users with >1000 objects (R2 list limit).
      const prefix = `uploads/${currentUser.id}/`;
      let cursor: string | undefined;
      do {
        const listed = await env.R2_BUCKET.list({ prefix, cursor }).catch(() => ({ objects: [] as Array<{ key: string }>, truncated: false, cursor: undefined as string | undefined }));
        if (listed.objects.length > 0) {
          await Promise.allSettled(
            listed.objects.map((obj: { key: string }) =>
              env.R2_BUCKET.delete(obj.key).catch((err: unknown) => {
                logWarn(`[deleteAccount] Failed to delete untracked R2 object ${obj.key}:`, err);
              })
            )
          );
        }
        cursor = listed.truncated ? (listed as { cursor?: string }).cursor : undefined;
      } while (cursor);
    } catch (err) {
      logError("[deleteAccount] R2 cleanup failed (proceeding with user deletion):", err);
      // Non-fatal: user deletion proceeds even if R2 cleanup partially fails.
    }

    // Delete user - cascades sessions, accounts; set-null on other FKs
    await db.delete(users).where(eq(users.id, currentUser.id));

    logInfo(`[auth] User ${currentUser.id} deleted their account`);

    // Clear session cookie
    appendCookies([
      createCookieString("session", "", 0, {
        appUrl: env.APP_URL,
        environment: env.ENVIRONMENT,
      }),
    ]);

    return { success: true };
  });
