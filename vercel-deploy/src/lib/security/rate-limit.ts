import "server-only";

/**
 * Fixed-window rate limiter for expensive or abusable route handlers.
 *
 * Scope: one server instance. It slows ordinary abuse and runaway loops, but it is NOT a
 * distributed limiter — Vercel runs many instances, so a determined attacker gets one budget per
 * instance. Before launch, back this with a shared store (Redis/Upstash) or the edge platform's
 * own rate limiting, and keep the same call sites.
 */

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();
const MAX_TRACKED_KEYS = 10_000;

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  resetAt: number;
  retryAfterSeconds: number;
};

export function rateLimit(key: string, limit = 30, windowMs = 60_000): RateLimitResult {
  const now = Date.now();

  if (buckets.size > MAX_TRACKED_KEYS) {
    for (const [bucketKey, bucket] of buckets) {
      if (bucket.resetAt <= now) buckets.delete(bucketKey);
    }
    // Still oversized: drop the oldest insertions rather than growing without bound.
    if (buckets.size > MAX_TRACKED_KEYS) {
      const overflow = buckets.size - MAX_TRACKED_KEYS;
      let removed = 0;
      for (const bucketKey of buckets.keys()) {
        buckets.delete(bucketKey);
        if (++removed >= overflow) break;
      }
    }
  }

  const existing = buckets.get(key);
  if (!existing || existing.resetAt <= now) {
    const resetAt = now + windowMs;
    buckets.set(key, { count: 1, resetAt });
    return { allowed: true, remaining: limit - 1, resetAt, retryAfterSeconds: 0 };
  }

  if (existing.count >= limit) {
    return {
      allowed: false,
      remaining: 0,
      resetAt: existing.resetAt,
      retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
    };
  }

  existing.count += 1;
  return {
    allowed: true,
    remaining: Math.max(0, limit - existing.count),
    resetAt: existing.resetAt,
    retryAfterSeconds: 0,
  };
}

/** Best-effort client identity for rate-limit keys. Never used for authorization. */
export function clientKey(request: Request, scope: string): string {
  const forwarded = request.headers.get("x-forwarded-for");
  const ip = forwarded?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
  return `${scope}:${ip}`;
}
