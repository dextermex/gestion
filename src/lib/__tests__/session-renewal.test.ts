import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decodeSession, SESSION_MAX_AGE } from "@/lib/sessionCookie";

/**
 * The server's reading of the session: a token still good is verified and
 * used; one at its end is renewed with the refresh token beside it, the
 * request is served under the new token and the renewed session is written
 * back the way the browser writes it. Nothing is believed that the account
 * system did not answer.
 */
interface SetCall {
  name: string;
  value: string;
  options: Record<string, unknown>;
}
let jar: Map<string, string>;
let sets: SetCall[];
let writable: boolean;
let requestHeaders: Record<string, string>;
const getUser = vi.fn();

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    has: (name: string) => jar.has(name),
    set: (name: string, value: string, options: Record<string, unknown>) => {
      if (!writable) throw new Error("Cookies can only be modified in a Server Action or Route Handler.");
      sets.push({ name, value, options });
      if (options.maxAge === 0) jar.delete(name);
      else jar.set(name, value);
    },
  }),
  headers: async () => new Headers(requestHeaders),
}));
vi.mock("@supabase/supabase-js", () => ({ createClient: () => ({ auth: { getUser } }) }));

const b64url = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
const jwt = (exp: number) => `${b64url({ alg: "HS256" })}.${b64url({ sub: "user-1", exp })}.signature`;
const now = () => Math.floor(Date.now() / 1000);
const cookieOf = (session: Record<string, unknown>) => `b64.${Buffer.from(JSON.stringify(session)).toString("base64url")}`;
const USER = { id: "user-1", email: "anne@example.lu", user_metadata: { first_name: "Anne" } };
const renewedBody = (over: Record<string, unknown> = {}) => ({ access_token: jwt(now() + 3600), token_type: "bearer", expires_in: 3600, refresh_token: "refresh-2", user: USER, ...over });
const answer = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

async function load() {
  const mod = await import("@/lib/supabase/server");
  mod.forgetRenewals();
  return mod;
}

beforeEach(() => {
  jar = new Map();
  sets = [];
  writable = true;
  requestHeaders = { host: "app.morada.lu", "x-forwarded-proto": "https" };
  getUser.mockReset();
  getUser.mockResolvedValue({ data: { user: USER }, error: null });
  vi.stubGlobal("fetch", vi.fn());
});
afterEach(() => vi.unstubAllGlobals());

describe("the session read on the server", () => {
  it("is nobody without a cookie, or with one that cannot be read", async () => {
    const { getSession } = await load();
    expect(await getSession()).toBeNull();
    jar.set("morada_auth", "b64.@@@");
    expect(await getSession()).toBeNull();
    jar.set("morada_auth", cookieOf({ refresh_token: "refresh-1" }));
    expect(await getSession()).toBeNull();
    expect(getUser).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("verifies a token still good and renews nothing", async () => {
    const token = jwt(now() + 1800);
    jar.set("morada_auth", cookieOf({ access_token: token, refresh_token: "refresh-1" }));
    const { getSession } = await load();
    expect(await getSession()).toMatchObject({ userId: "user-1", email: "anne@example.lu", accessToken: token, metadata: { first_name: "Anne" }, user: { id: "user-1" } });
    expect(getUser).toHaveBeenCalledWith(token);
    expect(fetch).not.toHaveBeenCalled();
    expect(sets).toEqual([]);
  });

  it("renews a token at its end, serves the request under the new one and writes the session back as the browser does", async () => {
    jar.set("morada_auth", cookieOf({ access_token: jwt(now() - 5), refresh_token: "refresh-1" }));
    const body = renewedBody();
    vi.mocked(fetch).mockResolvedValue(answer(200, body));
    const { getSession } = await load();
    const session = await getSession();
    expect(session).toMatchObject({ userId: "user-1", email: "anne@example.lu", accessToken: body.access_token, metadata: { first_name: "Anne" }, user: { id: "user-1" } });
    // The expired token is not sent for verification; the refresh token is sent once, to the account system only.
    expect(getUser).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/auth\/v1\/token\?grant_type=refresh_token$/);
    expect(JSON.parse(String(init.body))).toEqual({ refresh_token: "refresh-1" });
    // One cookie, the shared scope, the browser's own flags: readable by the browser client, never wider than before.
    expect(sets).toHaveLength(1);
    expect(sets[0].name).toBe("morada_auth");
    expect(sets[0].options).toEqual({ path: "/", sameSite: "lax", secure: true, domain: ".morada.lu", maxAge: SESSION_MAX_AGE });
    const stored = JSON.parse(decodeSession(sets[0].value));
    expect(stored).toMatchObject({ access_token: body.access_token, refresh_token: "refresh-2", token_type: "bearer", expires_in: 3600, user: USER });
    expect(stored.expires_at).toBeGreaterThan(now());
  });

  it("stays host-scoped and without the secure flag away from morada.lu", async () => {
    requestHeaders = { host: "127.0.0.1:4321" };
    jar.set("morada_auth", cookieOf({ access_token: jwt(now() - 5), refresh_token: "refresh-1" }));
    vi.mocked(fetch).mockResolvedValue(answer(200, renewedBody()));
    const { getSession } = await load();
    expect(await getSession()).not.toBeNull();
    expect(sets[0].options).toEqual({ path: "/", sameSite: "lax", secure: false, maxAge: SESSION_MAX_AGE });
  });

  it("renews a token the account system refuses, and nothing when it cannot be reached", async () => {
    const token = jwt(now() + 1800);
    jar.set("morada_auth", cookieOf({ access_token: token, refresh_token: "refresh-1" }));
    getUser.mockResolvedValueOnce({ data: { user: null }, error: { status: 403, message: "session_not_found" } });
    const body = renewedBody();
    vi.mocked(fetch).mockResolvedValue(answer(200, body));
    const { getSession, forgetRenewals } = await load();
    expect((await getSession())?.accessToken).toBe(body.access_token);

    forgetRenewals();
    vi.mocked(fetch).mockClear();
    jar.set("morada_auth", cookieOf({ access_token: token, refresh_token: "refresh-1" }));
    getUser.mockResolvedValueOnce({ data: { user: null }, error: { status: 0, message: "fetch failed" } });
    expect(await getSession()).toBeNull();
    getUser.mockRejectedValueOnce(new Error("network"));
    expect(await getSession()).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("is signed out when there is no refresh token, when the renewal is refused, and when it cannot be reached", async () => {
    const { getSession } = await load();
    jar.set("morada_auth", cookieOf({ access_token: jwt(now() - 5) }));
    expect(await getSession()).toBeNull();
    expect(fetch).not.toHaveBeenCalled();

    jar.set("morada_auth", cookieOf({ access_token: jwt(now() - 5), refresh_token: "revoked" }));
    vi.mocked(fetch).mockResolvedValueOnce(answer(400, { error_code: "refresh_token_not_found" }));
    expect(await getSession()).toBeNull();
    vi.mocked(fetch).mockRejectedValueOnce(new Error("timeout"));
    expect(await getSession()).toBeNull();
    vi.mocked(fetch).mockResolvedValueOnce(answer(200, { access_token: "x" }));
    expect(await getSession()).toBeNull();
    // Nothing was written and nothing was erased: the browser keeps what it has.
    expect(sets).toEqual([]);
  });

  it("still serves a page render, which cannot write cookies", async () => {
    writable = false;
    jar.set("morada_auth", cookieOf({ access_token: jwt(now() - 5), refresh_token: "refresh-1" }));
    const body = renewedBody();
    vi.mocked(fetch).mockResolvedValue(answer(200, body));
    const { getSession } = await load();
    expect((await getSession())?.accessToken).toBe(body.access_token);
    expect(sets).toEqual([]);
  });

  it("asks for one renewal when several requests arrive with the same expired token", async () => {
    writable = false; // each request keeps arriving with the cookie it was sent with
    jar.set("morada_auth", cookieOf({ access_token: jwt(now() - 5), refresh_token: "refresh-1" }));
    const body = renewedBody();
    vi.mocked(fetch).mockImplementation(async () => answer(200, body));
    const { getSession } = await load();
    const all = await Promise.all([getSession(), getSession(), getSession()]);
    expect(all.map((s) => s?.accessToken)).toEqual([body.access_token, body.access_token, body.access_token]);
    await getSession();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("splits a long session over numbered cookies and erases the pieces the new one does not use", async () => {
    // The previous session was one cookie; the renewed one needs several.
    jar.set("morada_auth", cookieOf({ access_token: jwt(now() - 5), refresh_token: "refresh-1" }));
    const long = renewedBody({ user: { ...USER, user_metadata: { note: "é".repeat(2600) } } });
    vi.mocked(fetch).mockResolvedValueOnce(answer(200, long));
    const { getSession, forgetRenewals } = await load();
    expect(await getSession()).not.toBeNull();
    const names = sets.filter((s) => s.options.maxAge !== 0).map((s) => s.name);
    expect(names.length).toBeGreaterThan(1);
    expect(names[0]).toBe("morada_auth.0");
    expect(sets.every((s) => s.value.length <= 3000)).toBe(true);
    expect(sets.find((s) => s.name === "morada_auth")?.options.maxAge).toBe(0);
    expect(jar.has("morada_auth")).toBe(false);
    // Read back whole, as the browser client reads it.
    const whole = names.map((n) => jar.get(n)).join("");
    expect(JSON.parse(decodeSession(whole)).user.user_metadata.note).toHaveLength(2600);

    // And the other way: a short session after a long one leaves no numbered piece behind.
    forgetRenewals();
    sets = [];
    jar.set("morada_auth.0", cookieOf({ access_token: jwt(now() - 5), refresh_token: "refresh-3" }));
    for (const name of [...jar.keys()]) if (name !== "morada_auth.0") jar.delete(name);
    jar.set("morada_auth.1", "");
    vi.mocked(fetch).mockResolvedValueOnce(answer(200, renewedBody()));
    expect(await getSession()).not.toBeNull();
    expect([...jar.keys()]).toEqual(["morada_auth"]);
  });
});

describe("when a token ends", () => {
  it("is read from the token without trusting it, with a margin", async () => {
    const { needsRenewal, tokenExpiry } = await load();
    const at = 1_800_000_000;
    expect(tokenExpiry(jwt(at))).toBe(at);
    expect(tokenExpiry("not-a-token")).toBeNull();
    expect(needsRenewal(jwt(at), (at - 3600) * 1000)).toBe(false);
    expect(needsRenewal(jwt(at), (at - 31) * 1000)).toBe(false);
    expect(needsRenewal(jwt(at), (at - 30) * 1000)).toBe(true);
    expect(needsRenewal(jwt(at), (at + 1) * 1000)).toBe(true);
    // A token whose end cannot be read is not renewed on a guess: the account system says whether it is good.
    expect(needsRenewal("not-a-token", at * 1000)).toBe(false);
  });
});
