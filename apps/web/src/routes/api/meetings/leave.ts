import { createFileRoute } from "@tanstack/react-router";
import { createDb } from "@ossmeet/db";
import { z } from "zod";
import { AppError } from "@ossmeet/shared";
import {
  getEnvFromRequest,
  getGuestCookieSecretFromCookie,
  verifySessionFromRawRequest,
} from "@/server/auth/helpers";
import { executeLeaveMeeting } from "@/server/meetings/leave-end.server";

const leaveBeaconSchema = z.object({
  sessionId: z.string().min(1).optional(),
  meetingId: z.string().min(1).optional(),
  participantId: z.string().min(1).optional(),
  finalizeIfEmpty: z.boolean().optional(),
});

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

        let parsedBody: unknown;
        try {
          parsedBody = await request.json();
        } catch {
          return new Response("Invalid JSON", { status: 400 });
        }

        const parsed = leaveBeaconSchema.safeParse(parsedBody);
        if (!parsed.success || !(parsed.data.sessionId ?? parsed.data.meetingId)) {
          return new Response("Invalid request", { status: 400 });
        }

        const db = createDb(env.DB);
        const session = await verifySessionFromRawRequest(request, env);
        const cookie = request.headers.get("Cookie");
        const guestCookieSecret = parsed.data.participantId
          ? getGuestCookieSecretFromCookie(cookie, parsed.data.participantId)
          : null;

        try {
          const result = await executeLeaveMeeting({
            env,
            db,
            meetingId: parsed.data.sessionId ?? parsed.data.meetingId!,
            participantId: parsed.data.participantId,
            authenticatedUserId: session?.userId ?? null,
            guestCookieSecret,
            rateLimitKey: session?.userId
              ? `meeting:leave:${session.userId}`
              : `meeting:leave:${getClientIpFromRequest(request)}`,
            removeFromLiveKit: false,
            promoteSuccessor: false,
            finalizeIfEmpty: parsed.data.finalizeIfEmpty ?? false,
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
