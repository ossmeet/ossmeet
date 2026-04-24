import serverEntry from "./server";
import { runCleanup } from "./server/cleanup";

export default {
  ...(serverEntry as object),
  async scheduled(event: { cron: string }, env: Env, ctx: ExecutionContext): Promise<void> {
    // Await so Cloudflare's cron dashboard reflects real success/failure.
    // waitUntil extends the isolate lifetime in case the runtime tries to
    // terminate early, but is not a substitute for awaiting the work itself.
    const work = runCleanup(event.cron, env);
    ctx.waitUntil(work);
    await work;
  },
};
