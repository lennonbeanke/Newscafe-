// In-memory sliding-window rate limiter (local development; a persistent limiter is a Plan B item).
// No timers: expired entries are pruned lazily while requests arrive, and the table size is bounded.
export class RateLimiter {
  private readonly hits = new Map<string, number[]>();
  private readonly maxKeys: number;
  private readonly now: () => number;
  constructor(maxKeys = 10_000, now: () => number = Date.now) { this.maxKeys = maxKeys; this.now = now; }

  /** Records one attempt. Returns whether it is allowed and, if not, how many seconds to wait. */
  hit(key: string, limit: number, windowMs: number): { allowed: boolean; retryAfterSec: number } {
    const t = this.now();
    const fresh = (this.hits.get(key) ?? []).filter((x) => x > t - windowMs);
    if (fresh.length >= limit) {
      this.hits.set(key, fresh);
      const oldest = fresh[0] ?? t;
      return { allowed: false, retryAfterSec: Math.max(1, Math.ceil((oldest + windowMs - t) / 1000)) };
    }
    fresh.push(t);
    this.hits.delete(key);          // re-insert so Map order approximates "least recently used first"
    this.hits.set(key, fresh);
    if (this.hits.size > this.maxKeys) {
      const oldestKey = this.hits.keys().next().value;
      if (oldestKey !== undefined) this.hits.delete(oldestKey);
    }
    return { allowed: true, retryAfterSec: 0 };
  }
  get size(): number { return this.hits.size; }
}
