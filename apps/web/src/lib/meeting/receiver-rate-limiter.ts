export class ReceiverRateLimiter {
  private limits = new Map<string, { count: number; resetAt: number }>();
  private lastPrunedAt = 0;

  constructor(
    private maxRate = 10,
    private windowMs = 1000
  ) {}

  shouldAllow(senderId: string): boolean {
    const now = Date.now();
    const entry = this.limits.get(senderId);
    if (entry && entry.resetAt > now) {
      if (entry.count >= this.maxRate) return false;
      entry.count++;
    } else {
      this.limits.set(senderId, { count: 1, resetAt: now + this.windowMs });
    }

    if (this.limits.size > 50 && now - this.lastPrunedAt > 10_000) {
      this.lastPrunedAt = now;
      for (const [k, v] of this.limits) {
        if (v.resetAt < now) this.limits.delete(k);
      }
    }

    return true;
  }
}
