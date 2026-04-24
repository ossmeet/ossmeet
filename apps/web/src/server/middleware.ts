import { createMiddleware } from "@tanstack/react-start";
import { createDb } from "@ossmeet/db";

const AUTH_HELPERS_MODULE = "./auth/helpers";

/**
 * Server function middleware that resolves auth, env bindings, and the DB
 * connection in a single place. Apply to all protected server functions via
 * `.middleware([authMiddleware])`.
 */
export const authMiddleware = createMiddleware({ type: "function" }).server(
  async ({ next }) => {
    const { requireAuth, getEnv } = await import(/* @vite-ignore */ AUTH_HELPERS_MODULE);
    const user = await requireAuth();
    const env = await getEnv();
    const db = createDb(env.DB);
    return next({ context: { user, env, db } });
  }
);
