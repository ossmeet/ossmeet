import { createDb } from "@ossmeet/db";
import { getActiveWhiteboardParticipantAccess } from "../server/meetings/whiteboard-access";
import { RequestBodyTooLargeError, readRequestBodyText } from "@/server/request-body";
import { timingSafeEqual } from "../../lib/crypto-utils";

const MAX_ACCESS_BODY_BYTES = 4 * 1024;
const ROLE_RANK: Record<string, number> = {
  guest: 0,
  participant: 1,
  host: 2,
};

export async function handleAccess(request: Request, env: Env): Promise<Response> {
  if (!env.WHITEBOARD_INTERNAL_SECRET) {
    return new Response("Service unavailable", { status: 503 });
  }

  const secret = request.headers.get("X-Whiteboard-Secret");
  if (!secret || !(await timingSafeEqual(secret, env.WHITEBOARD_INTERNAL_SECRET))) {
    return new Response("Unauthorized", { status: 401 });
  }

  let bodyText: string;
  try {
    bodyText = await readRequestBodyText(request, MAX_ACCESS_BODY_BYTES);
  } catch (err) {
    if (err instanceof RequestBodyTooLargeError) {
      return new Response("Payload too large", { status: 413 });
    }
    throw err;
  }

  let body: {
    connectionId?: unknown;
    sid?: unknown;
    sub?: unknown;
    role?: unknown;
  };
  try {
    body = JSON.parse(bodyText) as typeof body;
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const connectionId = typeof body.connectionId === "string" ? body.connectionId.trim() : "";
  const sid = typeof body.sid === "string" ? body.sid.trim() : "";
  const subject = typeof body.sub === "string" ? body.sub.trim() : "";
  const claimedRole = typeof body.role === "string" ? body.role.trim() : "";

  if (!connectionId || !sid.startsWith("meet-") || !subject || !(claimedRole in ROLE_RANK)) {
    return new Response("Invalid payload", { status: 400 });
  }

  const access = await getActiveWhiteboardParticipantAccess(
    createDb(env.DB),
    sid.slice("meet-".length),
    connectionId,
  );

  if (!access) {
    return Response.json({ active: false });
  }

  const roleStillAllowed = ROLE_RANK[claimedRole] <= ROLE_RANK[access.role];
  const active = access.participantIdentity === subject && roleStillAllowed;

  return Response.json({ active });
}
