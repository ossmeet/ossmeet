import type { Database } from "@ossmeet/db";
import { verifyWhiteboardJWT } from "../../lib/whiteboard-jwt";
import {
  getActiveWhiteboardParticipantAccess,
  type ActiveWhiteboardParticipantAccess,
} from "../server/meetings/whiteboard-access";

export interface ActiveWhiteboardAuth {
  meetingId: string;
  token: string;
  access: ActiveWhiteboardParticipantAccess;
}

export async function verifyActiveWhiteboardBearer(
  request: Request,
  env: Env,
  db: Database,
): Promise<ActiveWhiteboardAuth | Response> {
  const authHeader = request.headers.get("Authorization");
  const token = authHeader?.startsWith("Bearer ")
    ? authHeader.slice("Bearer ".length).trim()
    : null;

  if (!token || !env.WHITEBOARD_JWT_SECRET) {
    return new Response("Unauthorized", { status: 401 });
  }

  let claims: Awaited<ReturnType<typeof verifyWhiteboardJWT>>;
  try {
    claims = await verifyWhiteboardJWT(token, env.WHITEBOARD_JWT_SECRET);
  } catch {
    return new Response("Unauthorized", { status: 401 });
  }

  if (!claims.sid.startsWith("meet-")) {
    return new Response("Forbidden", { status: 403 });
  }

  const meetingId = claims.sid.slice("meet-".length);
  const access = await getActiveWhiteboardParticipantAccess(db, meetingId, claims.connectionId);
  if (!access || access.participantIdentity !== claims.sub) {
    return new Response("Forbidden", { status: 403 });
  }

  return { meetingId, token, access };
}
