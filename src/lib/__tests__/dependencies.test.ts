import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * The framework's floor: 15.5.27 and earlier carry published advisories, and
 * the sibling site holds the same floor. The lock decides what `npm ci`
 * installs, so it is read too: the framework and its compiler packages at
 * one version, at or above the floor.
 */
const FLOOR = [15, 5, 29] as const;
const parse = (v: string) => v.replace(/^[^\d]*/, "").split(".").map((n) => parseInt(n, 10));
const atLeast = (v: string) => {
  const [a, b, c] = parse(v);
  return a > FLOOR[0] || (a === FLOOR[0] && (b > FLOOR[1] || (b === FLOOR[1] && c >= FLOOR[2])));
};

describe("the framework version", () => {
  const root = path.resolve(__dirname, "../../..");
  const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")) as { dependencies: Record<string, string> };
  const lock = JSON.parse(readFileSync(path.join(root, "package-lock.json"), "utf8")) as { packages: Record<string, { version?: string }> };

  it("is asked for at or above the floor", () => {
    expect(atLeast(pkg.dependencies.next)).toBe(true);
  });

  it("is locked at or above the floor, with its compiler packages at the same version", () => {
    const locked = lock.packages["node_modules/next"]?.version ?? "";
    expect(atLeast(locked)).toBe(true);
    const companions = Object.entries(lock.packages).filter(([k]) => k.startsWith("node_modules/@next/") && !k.includes("eslint"));
    expect(companions.length).toBeGreaterThan(0);
    for (const [name, entry] of companions) expect(entry.version, name).toBe(locked);
  });
});
