import { describe, expect, it } from "vitest";
import { DECELERATION, project, releaseVelocity, rubberband, shouldDismiss } from "@/lib/gesture";

/**
 * The arithmetic behind a sheet or a drawer pulled away with a finger:
 * where a flick would carry it, how hard it resists past its open position,
 * how fast the finger was going when it let go, and whether that closes it.
 */
describe("momentum projection", () => {
  it("carries a release forward the way a scroll view decelerates", () => {
    // UIKit's rate: 1000 px/s comes to rest about 499px further on.
    expect(project(1000)).toBeCloseTo((1 * DECELERATION) / (1 - DECELERATION), 6);
    expect(project(1000)).toBeCloseTo(499, 0);
    expect(project(0)).toBe(0);
    expect(project(-600)).toBeCloseTo(-project(600), 6);
  });
});

describe("rubber band", () => {
  it("follows less and less the further past the edge, and never stops dead", () => {
    const size = 400;
    const a = rubberband(-50, size);
    const b = rubberband(-100, size);
    const c = rubberband(-400, size);
    expect(a).toBeLessThan(0);
    expect(Math.abs(a)).toBeLessThan(50);
    expect(Math.abs(b)).toBeGreaterThan(Math.abs(a));
    expect(Math.abs(b) - Math.abs(a)).toBeLessThan(Math.abs(a));
    expect(Math.abs(c)).toBeLessThan(size * 0.55);
    expect(rubberband(0, size)).toBe(0);
    expect(rubberband(30, 0)).toBe(0);
  });
});

describe("release velocity", () => {
  it("reads the finger's speed over its last moments", () => {
    const samples = [
      { t: 0, v: 0 },
      { t: 50, v: 10 },
      { t: 150, v: 20 },
      { t: 200, v: 60 },
      { t: 250, v: 100 },
    ];
    // Over the last 100ms: 20px to 100px in 100ms.
    expect(releaseVelocity(samples)).toBeCloseTo(800, 6);
  });

  it("is zero when the finger had stopped or never moved", () => {
    expect(releaseVelocity([])).toBe(0);
    expect(releaseVelocity([{ t: 10, v: 40 }])).toBe(0);
    expect(releaseVelocity([{ t: 0, v: 40 }, { t: 300, v: 40 }])).toBe(0);
  });
});

describe("dismissal", () => {
  const size = 400;
  it("closes on a pull past halfway, or on a flick", () => {
    expect(shouldDismiss(240, 0, size)).toBe(true);
    // 60px down, but thrown at 700 px/s: it was going well past halfway.
    expect(shouldDismiss(60, 700, size)).toBe(true);
  });

  it("stays open on a short, slow pull", () => {
    expect(shouldDismiss(80, 0, size)).toBe(false);
    expect(shouldDismiss(80, 150, size)).toBe(false);
  });

  it("stays open when the finger was taking it back, wherever it let go", () => {
    expect(shouldDismiss(300, -400, size)).toBe(false);
  });

  it("stays open when it was never pulled away from open", () => {
    expect(shouldDismiss(0, 900, size)).toBe(false);
    expect(shouldDismiss(-12, 900, size)).toBe(false);
    expect(shouldDismiss(300, 0, 0)).toBe(false);
  });
});
