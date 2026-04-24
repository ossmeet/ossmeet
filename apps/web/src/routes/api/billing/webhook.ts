import { createFileRoute } from "@tanstack/react-router";
import { createDb } from "@ossmeet/db";
import { users } from "@ossmeet/db/schema";
import { eq } from "drizzle-orm";
import { getEnvFromRequest } from "@/server/auth/helpers";
import { verifyPaddleWebhookSignature } from "@/lib/paddle";
import { withD1Retry } from "@/lib/db-utils";
import { logError, logWarn } from "@/lib/logger";
import type { PlanType } from "@ossmeet/shared";

// Maps Paddle price IDs → OSSMeet plan. Env vars are read at request time.
function priceIdToPlan(priceId: string, env: Env): PlanType | null {
  if (env.PADDLE_PRICE_ID_PRO && priceId === env.PADDLE_PRICE_ID_PRO) return "pro";
  if (env.PADDLE_PRICE_ID_ORG && priceId === env.PADDLE_PRICE_ID_ORG) return "org";
  return null;
}

function paddleStatusToSubscriptionStatus(status: string) {
  const map: Record<string, "active" | "canceled" | "past_due" | "trialing" | "paused"> = {
    active: "active",
    canceled: "canceled",
    past_due: "past_due",
    trialing: "trialing",
    paused: "paused",
  };
  return map[status] ?? null;
}

export const Route = createFileRoute("/api/billing/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const env = await getEnvFromRequest(request);
        if (!env?.PADDLE_WEBHOOK_SECRET) return new Response("Service unavailable", { status: 503 });

        const body = await request.text();
        const signature = request.headers.get("Paddle-Signature") ?? "";

        const valid = await verifyPaddleWebhookSignature(body, signature, env.PADDLE_WEBHOOK_SECRET).catch(() => false);
        if (!valid) {
          logWarn("[paddle-webhook] Invalid signature");
          return new Response("Unauthorized", { status: 401 });
        }

        let event: { event_type: string; data: Record<string, unknown> };
        try {
          event = JSON.parse(body) as typeof event;
        } catch {
          return new Response("Invalid JSON", { status: 400 });
        }

        const ctx = (request as unknown as { __cloudflare?: { ctx?: ExecutionContext } }).__cloudflare?.ctx;
        const work = handlePaddleEvent(event, env).catch((err) => {
          logError("[paddle-webhook] Unhandled error:", err);
        });

        if (ctx) ctx.waitUntil(work);
        else await work;

        return new Response("OK", { status: 200 });
      },
    },
  },
});

async function handlePaddleEvent(
  event: { event_type: string; data: Record<string, unknown> },
  env: Env,
): Promise<void> {
  const { event_type, data } = event;

  if (
    event_type === "subscription.created" ||
    event_type === "subscription.updated"
  ) {
    const subscriptionId = data["id"] as string | undefined;
    const customerId = data["customer_id"] as string | undefined;
    const status = data["status"] as string | undefined;
    const items = data["items"] as Array<{ price: { id: string } }> | undefined;
    const priceId = items?.[0]?.price?.id;
    const customDataRaw = data["custom_data"];
    const userId = (customDataRaw as Record<string, string> | null)?.["userId"];

    if (!subscriptionId || !customerId) {
      logWarn("[paddle-webhook] Missing subscriptionId or customerId", { event_type });
      return;
    }

    const plan = priceId ? priceIdToPlan(priceId, env) : null;
    const subscriptionStatus = status ? paddleStatusToSubscriptionStatus(status) : null;

    const db = createDb(env.DB);

    // Resolve the user: prefer customData.userId, fall back to paddleCustomerId lookup.
    let userRow: { id: string } | undefined;
    if (userId) {
      userRow = await db.query.users.findFirst({ where: eq(users.id, userId), columns: { id: true } });
    }
    if (!userRow) {
      userRow = await db.query.users.findFirst({ where: eq(users.paddleCustomerId, customerId), columns: { id: true } });
    }
    if (!userRow) {
      logWarn("[paddle-webhook] No user found for subscription", { customerId, userId });
      return;
    }

    await withD1Retry(() =>
      db.update(users).set({
        paddleCustomerId: customerId,
        paddleSubscriptionId: subscriptionId,
        subscriptionStatus: subscriptionStatus ?? undefined,
        ...(plan ? { plan } : {}),
        updatedAt: new Date(),
      }).where(eq(users.id, userRow.id))
    );
    return;
  }

  if (event_type === "subscription.canceled") {
    const subscriptionId = data["id"] as string | undefined;
    if (!subscriptionId) return;

    const db = createDb(env.DB);
    await withD1Retry(() =>
      db.update(users).set({
        plan: "free",
        subscriptionStatus: "canceled",
        paddleSubscriptionId: null,
        updatedAt: new Date(),
      }).where(eq(users.paddleSubscriptionId, subscriptionId))
    );
    return;
  }
}
