import { describe, expect, it } from "vitest";
import { createRateLimiter } from "@/lib/rate-limit";

/**
 * The sliding window behind the paid calls: so many per key inside each
 * window, the wait until the oldest hit leaves it, and keys kept apart.
 */
describe("the rate limiter", () => {
  it("lets the limit through, refuses the next with the wait until room comes back", () => {
    const rl = createRateLimiter([{ limit: 3, windowMs: 60_000 }]);
    expect(rl.take("a", 0)).toEqual({ ok: true, remaining: 2 });
    expect(rl.take("a", 10_000)).toEqual({ ok: true, remaining: 1 });
    expect(rl.take("a", 20_000)).toEqual({ ok: true, remaining: 0 });
    expect(rl.take("a", 30_000)).toEqual({ ok: false, retryAfterSec: 30 });
    // A refusal is not counted: the first hit leaves at 60 s and one more fits.
    expect(rl.take("a", 60_000).ok).toBe(true);
    expect(rl.take("a", 60_001).ok).toBe(false);
  });

  it("keeps keys apart", () => {
    const rl = createRateLimiter([{ limit: 1, windowMs: 1000 }]);
    expect(rl.take("a", 0).ok).toBe(true);
    expect(rl.take("b", 0).ok).toBe(true);
    expect(rl.take("a", 1).ok).toBe(false);
  });

  it("holds every window at once: a burst and a day", () => {
    const rl = createRateLimiter([
      { limit: 2, windowMs: 60_000 },
      { limit: 3, windowMs: 86_400_000 },
    ]);
    expect(rl.take("a", 0).ok).toBe(true);
    expect(rl.take("a", 1).ok).toBe(true);
    expect(rl.take("a", 2).ok).toBe(false);
    expect(rl.take("a", 61_000).ok).toBe(true);
    const day = rl.take("a", 122_000);
    expect(day.ok).toBe(false);
    expect(day.ok ? 0 : day.retryAfterSec).toBeGreaterThan(80_000);
  });

  it("forgets on reset", () => {
    const rl = createRateLimiter([{ limit: 1, windowMs: 1000 }]);
    rl.take("a", 0);
    rl.reset();
    expect(rl.take("a", 1).ok).toBe(true);
  });
});
