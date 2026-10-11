/**
 * A sliding window per key, in the memory of one server instance: a cheap
 * first brake on what costs money or reputation per call (the document
 * reader, outgoing e-mail). It is not a quota ledger: each instance counts
 * on its own, and a cold start forgets. Where a durable count exists (the
 * outbox's own rows) the caller checks it as well. Pure, so it is tested
 * without a clock.
 */
export interface RateWindow {
  /** How many hits a key may make inside the window. */
  limit: number;
  windowMs: number;
}

export type RateVerdict = { ok: true; remaining: number } | { ok: false; retryAfterSec: number };

/** Keys remembered at most; past it the oldest key is forgotten first. */
const MAX_KEYS = 5000;

export interface RateLimiter {
  /** Counts one hit for the key when the window has room, and says so. */
  take(key: string, now?: number): RateVerdict;
  /** Forgets everything (tests). */
  reset(): void;
}

export function createRateLimiter(windows: readonly RateWindow[]): RateLimiter {
  const longest = Math.max(...windows.map((w) => w.windowMs));
  const hits = new Map<string, number[]>();
  return {
    take(key, now = Date.now()) {
      const kept = (hits.get(key) ?? []).filter((t) => now - t < longest);
      for (const w of windows) {
        const inside = kept.filter((t) => now - t < w.windowMs);
        if (inside.length >= w.limit) {
          hits.set(key, kept);
          const oldest = inside[inside.length - w.limit];
          return { ok: false, retryAfterSec: Math.max(1, Math.ceil((oldest + w.windowMs - now) / 1000)) };
        }
      }
      kept.push(now);
      // Re-inserted last, so the map's order is the order of last use.
      hits.delete(key);
      hits.set(key, kept);
      if (hits.size > MAX_KEYS) {
        const first = hits.keys().next().value;
        if (first !== undefined) hits.delete(first);
      }
      const remaining = Math.min(...windows.map((w) => w.limit - kept.filter((t) => now - t < w.windowMs).length));
      return { ok: true, remaining };
    },
    reset() {
      hits.clear();
    },
  };
}
