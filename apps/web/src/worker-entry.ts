import serverEntry from "./server";
import { runCleanup } from "./server/cleanup";
import { whiteboardFetchHandler } from "@whiteboard/api";

const serverFetch = (serverEntry as Record<string, unknown>).fetch as (
  request: Request,
  env: Env,
  ctx: ExecutionContext,
) => Promise<Response>;

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (whiteboardFetchHandler) {
      const response = await whiteboardFetchHandler(request, env, ctx);
      if (response) return response;
    }
    return serverFetch(request, env, ctx);
  },
  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    // Await so Cloudflare's cron dashboard reflects real success/failure.
    // waitUntil extends the isolate lifetime in case the runtime tries to
    // terminate early, but is not a substitute for awaiting the work itself.
    const work = runCleanup(controller.cron, env);
    ctx.waitUntil(work);
    await work;
  },
};
