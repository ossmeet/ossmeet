export class RateLimiter {
  private limits = new Map<string, { count: number; bytes: number; windowStart: number }>();
  private callCount = 0;
  private readonly maxBytesPerWindow: number;
  private cleanupInterval: ReturnType<typeof setInterval>;

  constructor(
    private readonly maxMessages: number,
    private readonly windowMs: number,
    maxBytesPerSecond = 1_048_576,
  ) {
    this.maxBytesPerWindow = Math.ceil(maxBytesPerSecond * (windowMs / 1000));
    this.cleanupInterval = setInterval(() => this.cleanup(), windowMs * 10);
  }

  check(key: string, messageBytes = 0): boolean {
    this.callCount++;
    if (this.callCount % 100 === 0) this.cleanup();

    const now = Date.now();
    const limit = this.limits.get(key);

    if (!limit || now - limit.windowStart >= this.windowMs) {
      if (messageBytes > this.maxBytesPerWindow) return false;
      this.limits.set(key, { count: 1, bytes: messageBytes, windowStart: now });
      return true;
    }

    if (limit.count >= this.maxMessages || limit.bytes + messageBytes > this.maxBytesPerWindow) {
      return false;
    }
    limit.count++;
    limit.bytes += messageBytes;
    return true;
  }

  remove(key: string): void {
    this.limits.delete(key);
  }

  cleanup(staleMultiplier = 3): void {
    const now = Date.now();
    const threshold = this.windowMs * staleMultiplier;
    for (const [key, limit] of this.limits) {
      if (now - limit.windowStart > threshold) {
        this.limits.delete(key);
      }
    }
  }

  destroy(): void {
    clearInterval(this.cleanupInterval);
    this.limits.clear();
  }
}
