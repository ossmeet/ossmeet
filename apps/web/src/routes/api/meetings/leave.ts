import { createFileRoute } from "@tanstack/react-router";
import { createDb } from "@ossmeet/db";
import { z } from "zod";
import { AppError } from "@ossmeet/shared";
import {
  getEnvFromRequest,
  getGuestCookieSecretFromCookie,
  verifySessionFromRawRequest,
} from "@/server/auth/helpers";
import { meetingLivekitPresences } from "@ossmeet/db/schema";
import { and, eq } from "drizzle-orm";
import { executeLeaveMeeting } from "@/server/meetings/leave-end.server";
import { RequestBodyTooLargeError, readRequestBodyText } from "@/server/request-body";

const leaveBeaconSchema = z.object({
  sessionId: z.string().min(1).optional(),
  meetingId: z.string().min(1).optional(),
  connectionId: z.string().min(1).optional(),
});

const MAX_LEAVE_BEACON_BODY_BYTES = 16 * 1024;

function getClientIpFromRequest(request: Request): string {
  // CF-Connecting-IP is authoritative behind Cloudflare; never trust
  // X-Forwarded-For in production as it can be spoofed by clients.
  return request.headers.get("CF-Connecting-IP") ?? "unknown";
}

export const Route = createFileRoute("/api/meetings/leave")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const env = await getEnvFromRequest(request);
        if (!env) {
          return new Response("Server configuration error", { status: 500 });
        }

        let bodyText: string;
        try {
          bodyText = await readRequestBodyText(request, MAX_LEAVE_BEACON_BODY_BYTES);
        } catch (err) {
          if (err instanceof RequestBodyTooLargeError) {
            return new Response("Payload too large", { status: 413 });
          }
          throw err;
        }

        let parsedBody: unknown;
        try {
          parsedBody = bodyText ? JSON.parse(bodyText) : {};
        } catch {
          return new Response("Invalid JSON", { status: 400 });
        }

        const parsed = leaveBeaconSchema.safeParse(parsedBody);
        if (!parsed.success || !(parsed.data.sessionId ?? parsed.data.meetingId)) {
          return new Response("Invalid request", { status: 400 });
        }

        const db = createDb(env.DB);
        const session = await verifySessionFromRawRequest(request, env);
        const connection = parsed.data.connectionId
          ? await db.query.meetingLivekitPresences.findFirst({
              where: and(
                eq(meetingLivekitPresences.id, parsed.data.connectionId),
                eq(meetingLivekitPresences.sessionId, parsed.data.sessionId ?? parsed.data.meetingId!),
              ),
              columns: { admissionId: true },
            })
          : null;
        const guestCookieSecret = connection?.admissionId
          ? getGuestCookieSecretFromCookie(request.headers.get("Cookie"), connection.admissionId)
          : null;
        try {
          const result = await executeLeaveMeeting({
            env,
            db,
            meetingId: parsed.data.sessionId ?? parsed.data.meetingId!,
            connectionId: parsed.data.connectionId,
            authenticatedUserId: session?.userId ?? null,
            guestCookieSecret,
            rateLimitKey: session?.userId
              ? `meeting:leave:${session.userId}`
              : `meeting:leave:${getClientIpFromRequest(request)}`,
            removeFromLiveKit: false,
            promoteSuccessor: false,
          });

          return Response.json(result);
        } catch (error) {
          if (error instanceof AppError) {
            return new Response(error.message, { status: error.statusCode });
          }
          throw error;
        }
      },
    },
  },
});
