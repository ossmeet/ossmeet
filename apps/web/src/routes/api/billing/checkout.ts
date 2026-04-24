import { createFileRoute } from "@tanstack/react-router";
import { createDb } from "@ossmeet/db";
import { users } from "@ossmeet/db/schema";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getEnvFromRequest, verifySessionFromRawRequest } from "@/server/auth/helpers";
import { getOrCreatePaddleCustomer } from "@/lib/paddle";
import { withD1Retry } from "@/lib/db-utils";

const bodySchema = z.object({
  plan: z.enum(["pro", "org"]),
});

export const Route = createFileRoute("/api/billing/checkout")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const env = await getEnvFromRequest(request);
        if (!env?.PADDLE_API_KEY) return new Response("Service unavailable", { status: 503 });

        const session = await verifySessionFromRawRequest(request, env);
        if (!session) return new Response("Unauthorized", { status: 401 });

        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return new Response("Invalid JSON", { status: 400 });
        }

        const parsed = bodySchema.safeParse(body);
        if (!parsed.success) return new Response("Invalid request", { status: 400 });

        const db = createDb(env.DB);
        const user = await db.query.users.findFirst({
          where: eq(users.id, session.userId),
          columns: { id: true, email: true, name: true, paddleCustomerId: true },
        });
        if (!user) return new Response("Not found", { status: 404 });

        let customerId = user.paddleCustomerId;
        if (!customerId) {
          customerId = await getOrCreatePaddleCustomer(env.PADDLE_API_KEY, user.email, user.name);
          await withD1Retry(() =>
            db.update(users).set({ paddleCustomerId: customerId, updatedAt: new Date() }).where(eq(users.id, user.id))
          );
        }

        const priceId =
          parsed.data.plan === "pro" ? env.PADDLE_PRICE_ID_PRO : env.PADDLE_PRICE_ID_ORG;
        if (!priceId) return new Response("Plan pricing not configured", { status: 503 });

        return Response.json({ customerId, priceId, email: user.email });
      },
    },
  },
});
