import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RATE, rateLimited, refuseOverRate, retryAfter, withinRate, type RateRule } from "@/lib/gestion/rate-limit";

/**
 * Rate limits are counted in the database, under the caller's token, per
 * person and per workspace. Here: what the count is asked, what each answer
 * means, and that a database without the function limits nothing rather
 * than stopping the product.
 */
const RULE: RateRule = { action: "mail.message", windowSeconds: 3600, perUser: 60, perOrg: 120 };
const ORG = "0b7e3c1a-4d55-4f0e-9a41-2f5d8c6b7a10";
const counter = (answer: { data: unknown; error: { code?: string; message?: string } | null } | Error) => ({
  rpc: vi.fn(async () => {
    if (answer instanceof Error) throw answer;
    return answer;
  }),
});

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("a counted call", () => {
  it("asks the database with the rule's window and both limits, keyed on the workspace", async () => {
    const g = counter({ data: true, error: null });
    expect(await withinRate(g, RULE, ORG)).toBe(true);
    expect(g.rpc).toHaveBeenCalledWith("rate_take", { p_action: "mail.message", p_org: ORG, p_window_seconds: 3600, p_user_max: 60, p_org_max: 120 });
  });

  it("keeps the person's counter alone when there is no workspace", async () => {
    const g = counter({ data: true, error: null });
    await withinRate(g, RULE, null);
    expect(g.rpc).toHaveBeenCalledWith("rate_take", expect.objectContaining({ p_org: null, p_org_max: null, p_user_max: 60 }));
  });

  it("is refused when the count says so, and when the database says the caller is not of this workspace", async () => {
    expect(await withinRate(counter({ data: false, error: null }), RULE, ORG)).toBe(false);
    expect(await withinRate(counter({ data: null, error: { code: "42501", message: "gestion: not a member of this workspace" } }), RULE, ORG)).toBe(false);
  });

  it("limits nothing on a database that does not carry the function yet, and says so", async () => {
    expect(await withinRate(counter({ data: null, error: { code: "PGRST202" } }), RULE, ORG)).toBe(true);
    expect(await withinRate(counter({ data: null, error: { code: "42883" } }), RULE, ORG)).toBe(true);
  });

  it("lets the call through when the count itself fails: a limiter never stops the product", async () => {
    expect(await withinRate(counter({ data: null, error: { code: "57014" } }), RULE, ORG)).toBe(true);
    expect(await withinRate(counter(new Error("network")), RULE, ORG)).toBe(true);
    expect(console.error).toHaveBeenCalled();
  });
});

describe("a refused call", () => {
  it("answers 429 with the code the screens word and the seconds to wait", async () => {
    const res = await refuseOverRate(counter({ data: false, error: null }), RULE, ORG);
    expect(res?.status).toBe(429);
    const wait = Number(res?.headers.get("retry-after"));
    expect(wait).toBeGreaterThan(0);
    expect(wait).toBeLessThanOrEqual(3600);
    expect(await res?.json()).toEqual({ error: "rate_limited", retryAfter: wait });
    expect(await refuseOverRate(counter({ data: true, error: null }), RULE, ORG)).toBeNull();
    expect(rateLimited(RULE).status).toBe(429);
  });

  it("waits until the window ends, as the database counts it", () => {
    expect(retryAfter(RULE, 3600_000 * 5)).toBe(3600);
    expect(retryAfter(RULE, 3600_000 * 5 + 1000)).toBe(3599);
    expect(retryAfter(RULE, 3600_000 * 6 - 1000)).toBe(1);
  });
});

describe("the rules", () => {
  it("are names and windows the database accepts", () => {
    const sql = readFileSync(path.resolve(__dirname, "../../../supabase/applied/0033_api_auth.sql"), "utf8");
    expect(sql).toContain("create or replace function gestion.rate_take(");
    expect(sql).toMatch(/security definer\s+set search_path = ''/);
    const names = new Set<string>();
    for (const rule of Object.values(RATE)) {
      expect(rule.action, rule.action).toMatch(/^[a-z][a-z0-9_.]{0,63}$/);
      expect(rule.windowSeconds).toBeGreaterThanOrEqual(10);
      expect(rule.windowSeconds).toBeLessThanOrEqual(86400);
      expect(rule.perUser === null || rule.perUser > 0).toBe(true);
      expect(rule.perOrg === null || rule.perOrg >= (rule.perUser ?? 0)).toBe(true);
      names.add(rule.action);
    }
    expect(names.size).toBe(Object.keys(RATE).length);
  });
});
