import { createFileRoute } from "@tanstack/react-router";
import { createDb } from "@ossmeet/db";
import { users } from "@ossmeet/db/schema";
import { eq } from "drizzle-orm";
import { getEnvFromRequest, verifySessionFromRawRequest } from "@/server/auth/helpers";
import { createPortalSession } from "@/lib/paddle";

export const Route = createFileRoute("/api/billing/portal")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const env = await getEnvFromRequest(request);
        if (!env?.PADDLE_API_KEY) return new Response("Service unavailable", { status: 503 });

        const session = await verifySessionFromRawRequest(request, env);
        if (!session) return new Response("Unauthorized", { status: 401 });

        const db = createDb(env.DB);
        const user = await db.query.users.findFirst({
          where: eq(users.id, session.userId),
          columns: { paddleCustomerId: true },
        });

        if (!user?.paddleCustomerId) {
          return new Response("No billing account found", { status: 404 });
        }

        const returnUrl = env.APP_URL + "/settings";
        const portalUrl = await createPortalSession(env.PADDLE_API_KEY, user.paddleCustomerId, returnUrl);

        return Response.redirect(portalUrl, 302);
      },
    },
  },
});
