// Simple in-memory sliding-window limiter (single process is fine for this deploy).
export function createRateLimiter(limit: number, windowMs: number) {
  const hits = new Map<string, number[]>();
  return {
    /** Records a hit; returns false when the key is over the limit. */
    check(key: string, now = Date.now()): boolean {
      const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
      if (recent.length >= limit) {
        hits.set(key, recent);
        return false;
      }
      recent.push(now);
      hits.set(key, recent);
      return true;
    },
  };
}

/** POST /api/jobs: 5 per IP per 10 minutes. */
export const jobCreationLimiter = createRateLimiter(5, 10 * 60_000);

export function clientIp(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "local";
}
