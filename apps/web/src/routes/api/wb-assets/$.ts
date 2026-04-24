import { createFileRoute } from "@tanstack/react-router";
import { createDb } from "@ossmeet/db";
import { meetingParticipants, meetingSessions } from "@ossmeet/db/schema";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { CURRENT_MEETING_PARTICIPANT_STATUSES } from "@ossmeet/shared";
import { verifyGuestSecret } from "@/lib/auth/crypto";
import { extractMeetingIdFromWhiteboardUploadKey } from "@/lib/whiteboard-asset-key";
import { verifySessionFromRawRequest, getEnvFromRequest } from "@/server/auth/helpers";
import { canAccessActiveMeetingAssets } from "@/server/transcripts/access";

// Whitelist of safe content types to serve inline.
// SVG is excluded to prevent stored XSS via embedded scripts.
const SAFE_CONTENT_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "application/pdf",
  "video/mp4",
  "video/webm",
  "audio/mpeg",
  "audio/wav",
  "audio/webm",
]);

/**
 * Serves whiteboard image assets from R2.
 * Path: /api/wb-assets/<r2-key>
 *
 * Requires a valid session cookie. Assets uploaded by the whiteboard are
 * stored in R2 under uploads/{userId}/wb/... This route serves them with
 * aggressive caching since asset keys contain timestamps.
 */
export const Route = createFileRoute("/api/wb-assets/$")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const { _splat, _ } = params as { _splat?: string; _?: string };
        const key = _splat ?? _;
        if (!key || key.includes("..")) {
          return new Response("Not found", { status: 404 });
        }

        // Only serve whiteboard uploads from the uploads/*/wb/<meetingId>/... prefix.
        const meetingId = extractMeetingIdFromWhiteboardUploadKey(key);
        if (!meetingId) {
          return new Response("Forbidden", { status: 403 });
        }

        // Access the R2 bucket binding from Cloudflare environment
        const env = await getEnvFromRequest(request);
        if (!env) {
          return new Response("Storage unavailable", { status: 503 });
        }
        const bucket = env.R2_BUCKET;

        if (!bucket) {
          return new Response("Storage unavailable", { status: 503 });
        }

        // --- Authentication ---
        // Non-whiteboard assets: always require a valid session.
        // Whiteboard assets (uploads/.../wb/): require a session OR an active
        // guest cookie (ossmeet_guest_*) set by the server at join time.
        // This eliminates pure URL-obscurity access while still allowing
        // guests to view images uploaded by authenticated participants.
        const session = await verifySessionFromRawRequest(request, env);
        const db = createDb(env.DB);

        if (session) {
          const allowed = await canAccessActiveMeetingAssets(db, meetingId, session.userId);
          if (!allowed) {
            return new Response("Forbidden", { status: 403 });
          }
        } else {
          // For whiteboard assets, validate guest access properly.
          // Parse guest cookies from the request, capped at 5 to bound DB and CPU cost.
          const cookie = request.headers.get("Cookie") ?? "";
          const guestCookies = cookie
            .split(";")
            .map(p => p.trim())
            .filter(p => p.startsWith("ossmeet_guest_"))
            .slice(0, 5)
            .map(p => {
              const eqIndex = p.indexOf("=");
              if (eqIndex === -1) return null;
              // Extract participant ID from cookie name: ossmeet_guest_{participantId}
              const cookieName = p.substring(0, eqIndex);
              const participantId = cookieName.replace("ossmeet_guest_", "");
              const rawValue = p.substring(eqIndex + 1);
              let guestSecret: string | null = null;
              try {
                guestSecret = rawValue ? decodeURIComponent(rawValue) : null;
              } catch {
                guestSecret = rawValue || null;
              }
              if (!guestSecret) return null;
              return { participantId, guestSecret };
            })
            .filter(
              (
                entry
              ): entry is { participantId: string; guestSecret: string } => entry !== null
            );
          
          if (guestCookies.length === 0) {
            return new Response("Unauthorized", { status: 401 });
          }
          
          // Verify at least one guest cookie belongs to a participant in this meeting
          const guestParticipants = await db
            .select({ id: meetingParticipants.id, guestSecret: meetingParticipants.guestSecret })
            .from(meetingParticipants)
            .innerJoin(
              meetingSessions,
              and(
                eq(meetingSessions.id, meetingParticipants.sessionId),
                eq(meetingSessions.status, "active"),
              ),
            )
            .where(
              and(
                eq(meetingParticipants.sessionId, meetingId),
                inArray(meetingParticipants.id, guestCookies.map(({ participantId }) => participantId)),
                inArray(meetingParticipants.status, CURRENT_MEETING_PARTICIPANT_STATUSES),
                isNull(meetingParticipants.userId),
              ),
            );

          let validGuest = false;
          for (const participant of guestParticipants) {
            if (!participant.guestSecret) continue;
            const cookieEntry = guestCookies.find(
              ({ participantId }) => participantId === participant.id
            );
            if (!cookieEntry) continue;
            if (await verifyGuestSecret(participant.guestSecret, cookieEntry.guestSecret)) {
              validGuest = true;
              break;
            }
          }

          if (!validGuest) {
            return new Response("Forbidden - Guest not authorized for this meeting", { status: 403 });
          }
        }

        // Check if client has cached version (conditional request)
        const ifNoneMatch = request.headers.get("If-None-Match");
        
        const object = await bucket.get(key);
        if (!object) {
          return new Response("Not found", { status: 404 });
        }

        // Return 304 Not Modified if ETag matches (bandwidth optimization).
        // Use httpEtag (RFC-compliant quoted string) for HTTP conditional requests.
        if (ifNoneMatch && object.httpEtag && ifNoneMatch === object.httpEtag) {
          return new Response(null, {
            status: 304,
            headers: {
              "ETag": object.httpEtag,
              "Cache-Control": "private, max-age=300",
              "Vary": "Cookie",
            }
          });
        }

        // Force safe content types to prevent stored XSS (e.g., SVG with scripts)
        const rawType = object.httpMetadata?.contentType ?? "application/octet-stream";
        const contentType = SAFE_CONTENT_TYPES.has(rawType)
          ? rawType
          : "application/octet-stream";

        const headers = new Headers();
        headers.set("Content-Type", contentType);
        headers.set("X-Content-Type-Options", "nosniff");
        headers.set("Cache-Control", "private, max-age=300");
        headers.set("Vary", "Cookie");

        if (object.httpEtag) {
          headers.set("ETag", object.httpEtag);
        }

        return new Response(object.body, { headers });
      },
    },
  },
});
