import { createServerFn } from "@tanstack/react-start";
import { createDb } from "@ossmeet/db";
import type { Database } from "@ossmeet/db";
import { meetingLivekitPresences, meetingSessions } from "@ossmeet/db/schema";
import { eq, and, inArray } from "drizzle-orm";
import { z } from "zod";
import { AppError, Errors } from "@ossmeet/shared";
import { updateScreenSharePermission } from "./screen-share.server";

const AUTH_HELPERS_MODULE = "../auth/helpers";

const grantScreenShareSchema = z.object({
  meetingId: z.string(),
  targetIdentity: z.string(),
  allow: z.boolean(),
  connectionId: z.string().optional(),
});

const revokeOwnScreenShareSchema = z.object({
  meetingId: z.string(),
  connectionId: z.string(),
});

export async function getGrantableMeetingParticipant(
  db: Database,
  meetingId: string,
  targetIdentity: string,
) {
  const connection = await db.query.meetingLivekitPresences.findFirst({
    where: and(
      eq(meetingLivekitPresences.sessionId, meetingId),
      inArray(meetingLivekitPresences.presenceStatus, ["connected", "token_issued"]),
      eq(meetingLivekitPresences.livekitIdentity, targetIdentity),
    ),
    columns: {
      id: true,
      admissionId: true,
      userId: true,
      livekitIdentity: true,
    },
  });

  if (!connection) {
    throw Errors.NOT_FOUND("Participant");
  }

  return {
    id: connection.admissionId,
    userId: connection.userId,
    livekitIdentity: connection.livekitIdentity,
  };
}

export const grantScreenShare = createServerFn({ method: "POST" })
  .inputValidator(grantScreenShareSchema)
  .handler(async ({ data }) => {
    const {
      getEnv,
      requireAuth,
      getGuestCookieSecret,
      getClientIP,
      enforceRateLimit,
    } = await import(/* @vite-ignore */ AUTH_HELPERS_MODULE);
    const env = await getEnv();
    const db = createDb(env.DB);

    let userId: string | null = null;
    try {
      const user = await requireAuth();
      userId = user.id;
    } catch (err) {
      if (!(err instanceof AppError && err.code === "UNAUTHORIZED")) throw err;
    }

    await enforceRateLimit(
      env,
      userId
        ? `screen-share:grant:${userId}`
        : `screen-share:grant:${getClientIP()}`,
    );

    const meeting = await db.query.meetingSessions.findFirst({
      where: and(
        eq(meetingSessions.id, data.meetingId),
        eq(meetingSessions.status, "active"),
      ),
    });

    if (!meeting) throw Errors.NOT_FOUND("Meeting");
    if (meeting.hostId !== userId) {
      if (!data.connectionId) throw Errors.FORBIDDEN();
      const connection = await db.query.meetingLivekitPresences.findFirst({
        where: and(
          eq(meetingLivekitPresences.id, data.connectionId),
          eq(meetingLivekitPresences.sessionId, data.meetingId),
          inArray(meetingLivekitPresences.presenceStatus, ["connected", "token_issued"]),
        ),
        columns: { admissionId: true },
      });
      const ownedPresence = await getOwnedActiveMeetingPresence(db, {
        meetingId: data.meetingId,
        connectionId: data.connectionId,
        authenticatedUserId: userId,
        guestCookieSecret: connection?.admissionId
          ? getGuestCookieSecret(connection.admissionId)
          : null,
      });
      if (ownedPresence.role !== "host") throw Errors.FORBIDDEN();
    }

    const participant = await getGrantableMeetingParticipant(
      db,
      meeting.id,
      data.targetIdentity,
    );

    await updateScreenSharePermission(env, meeting.id, participant.livekitIdentity, data.allow);

    return { success: true };
  });

export async function getOwnedActiveMeetingPresence(
  db: Database,
  input: {
    meetingId: string;
    connectionId: string;
    authenticatedUserId: string | null;
    guestCookieSecret?: string | null;
  },
) {
  const connection = await db.query.meetingLivekitPresences.findFirst({
    where: and(
      eq(meetingLivekitPresences.id, input.connectionId),
      eq(meetingLivekitPresences.sessionId, input.meetingId),
      inArray(meetingLivekitPresences.presenceStatus, ["connected", "token_issued"]),
    ),
    columns: {
      id: true,
      admissionId: true,
      userId: true,
      livekitIdentity: true,
      role: true,
    },
  });

  if (!connection) throw Errors.NOT_FOUND("Participant");

  if (input.authenticatedUserId) {
    if (connection.userId !== input.authenticatedUserId) throw Errors.FORBIDDEN();
  } else {
    if (connection.userId !== null) throw Errors.FORBIDDEN();
    const { verifyGuestAdmissionBySecret } = await import(/* @vite-ignore */ AUTH_HELPERS_MODULE);
    await verifyGuestAdmissionBySecret(
      db,
      input.meetingId,
      connection.admissionId,
      input.guestCookieSecret ?? null,
    );
  }

  return connection;
}

export const revokeOwnScreenShare = createServerFn({ method: "POST" })
  .inputValidator(revokeOwnScreenShareSchema)
  .handler(async ({ data }) => {
    const {
      getEnv,
      requireAuth,
      getGuestCookieSecret,
      getClientIP,
      enforceRateLimit,
    } = await import(/* @vite-ignore */ AUTH_HELPERS_MODULE);
    const env = await getEnv();
    const db = createDb(env.DB);

    let userId: string | null = null;
    try {
      const user = await requireAuth();
      userId = user.id;
    } catch (err) {
      if (!(err instanceof AppError && err.code === "UNAUTHORIZED")) throw err;
    }

    await enforceRateLimit(
      env,
      userId
        ? `screen-share:revoke:${userId}`
        : `screen-share:revoke:${getClientIP()}`,
    );

    const connection = await db.query.meetingLivekitPresences.findFirst({
      where: and(
        eq(meetingLivekitPresences.id, data.connectionId),
        eq(meetingLivekitPresences.sessionId, data.meetingId),
        inArray(meetingLivekitPresences.presenceStatus, ["connected", "token_issued"]),
      ),
      columns: { admissionId: true },
    });

    const ownedPresence = await getOwnedActiveMeetingPresence(db, {
      meetingId: data.meetingId,
      connectionId: data.connectionId,
      authenticatedUserId: userId,
      guestCookieSecret: connection?.admissionId
        ? getGuestCookieSecret(connection.admissionId)
        : null,
    });

    await updateScreenSharePermission(env, data.meetingId, ownedPresence.livekitIdentity, false);
    return { success: true };
  });
