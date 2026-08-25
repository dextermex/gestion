import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createCookieStorage } from "@/lib/sessionCookie";

/**
 * A fake browser that enforces the two rules the real one enforces: a cookie
 * cannot exceed 4096 bytes, and it must be scoped to the parent domain for
 * app.morada.lu and morada.lu to see the same session.
 */
const KEY = "morada_auth";
let jar: Map<string, string>;
let rejected: string[];

function fakeBrowser(hostname = "app.morada.lu") {
  jar = new Map();
  rejected = [];
  const store = new Map<string, string>();

  (globalThis as unknown as { window: unknown }).window = {
    location: { hostname, protocol: "https:" },
    localStorage: {
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    },
  };

  (globalThis as unknown as { document: unknown }).document = {
    get cookie() {
      return [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
    },
    set cookie(raw: string) {
      // A browser silently drops an oversized cookie: record it instead so a
      // test can assert we never hand one over.
      if (raw.length > 4096) {
        rejected.push(raw.slice(0, 40));
        return;
      }
      const [pair, ...attrs] = raw.split("; ");
      const eq = pair.indexOf("=");
      const name = pair.slice(0, eq);
      if (attrs.includes("max-age=0")) jar.delete(name);
      else jar.set(name, pair.slice(eq + 1));
    },
  };
  return store;
}

function bigSession() {
  return JSON.stringify({
    access_token: `e${"y".repeat(1800)}`,
    refresh_token: "r".repeat(60),
    expires_at: 1790000000,
    user: { id: "8b2c", email: "jean@example.lu", name: "Jean Weber", note: "é".repeat(400) },
  });
}

afterEach(() => {
  delete (globalThis as Record<string, unknown>).window;
  delete (globalThis as Record<string, unknown>).document;
});

describe("sessionCookie", () => {
  beforeEach(() => fakeBrowser());

  it("reads nothing when no session was ever stored", () => {
    expect(createCookieStorage({ mirrorToLocalStorage: true }).getItem(KEY)).toBeNull();
  });

  it("round-trips a small session in a single cookie", () => {
    const s = createCookieStorage({ mirrorToLocalStorage: true });
    s.setItem(KEY, '{"access_token":"court"}');
    expect(s.getItem(KEY)).toBe('{"access_token":"court"}');
    expect(jar.size).toBe(1);
  });

  it("round-trips a session too large for one cookie", () => {
    const s = createCookieStorage({ mirrorToLocalStorage: true });
    const value = bigSession();
    s.setItem(KEY, value);
    expect(s.getItem(KEY)).toBe(value);
    expect(jar.size).toBeGreaterThan(1);
  });

  it("never hands the browser an oversized cookie", () => {
    const s = createCookieStorage({ mirrorToLocalStorage: true });
    s.setItem(KEY, bigSession());
    // The bug this guards: chunking on the raw length, then encoding, pushed
    // an accented session to 4509 bytes and the browser threw it away.
    expect(rejected).toEqual([]);
  });

  it("scopes the cookie to the parent domain so both spaces see it", () => {
    let written = "";
    const doc = (globalThis as unknown as { document: { cookie: string } }).document;
    Object.defineProperty(doc, "cookie", {
      get: () => "",
      set: (raw: string) => void (written = raw),
      configurable: true,
    });
    createCookieStorage({ mirrorToLocalStorage: true }).setItem(KEY, '{"a":1}');
    expect(written).toContain("domain=.morada.lu");
    expect(written).toContain("samesite=lax");
    expect(written).toContain("secure");
  });

  it("stays host-scoped outside morada.lu", () => {
    fakeBrowser("localhost");
    let written = "";
    const doc = (globalThis as unknown as { document: { cookie: string } }).document;
    Object.defineProperty(doc, "cookie", {
      get: () => "",
      set: (raw: string) => void (written = raw),
      configurable: true,
    });
    createCookieStorage({ mirrorToLocalStorage: true }).setItem(KEY, '{"a":1}');
    expect(written).not.toContain("domain=");
  });

  it("leaves no orphan chunk when a large session is replaced by a small one", () => {
    const s = createCookieStorage({ mirrorToLocalStorage: true });
    s.setItem(KEY, bigSession());
    s.setItem(KEY, '{"a":1}');
    expect(jar.size).toBe(1);
    expect(s.getItem(KEY)).toBe('{"a":1}');
  });

  it("clears cookie and localStorage on sign-out", () => {
    const store = fakeBrowser();
    const s = createCookieStorage({ mirrorToLocalStorage: true });
    s.setItem(KEY, bigSession());
    s.removeItem(KEY);
    expect(jar.size).toBe(0);
    expect(s.getItem(KEY)).toBeNull();
    expect(store.get(KEY)).toBeUndefined();
  });

  it("adopts an existing localStorage session so nobody is signed out", () => {
    const store = fakeBrowser();
    const value = bigSession();
    store.set(KEY, value);
    const s = createCookieStorage({ mirrorToLocalStorage: true });
    expect(s.getItem(KEY)).toBe(value);
    expect(jar.size).toBeGreaterThan(0); // promoted to the shared cookie
  });

  it("keeps localStorage in step while the mirror is on, so a revert is free", () => {
    const store = fakeBrowser();
    const s = createCookieStorage({ mirrorToLocalStorage: true });
    const value = bigSession();
    s.setItem(KEY, value);
    expect(store.get(KEY)).toBe(value);
  });

  it("stops writing localStorage once the mirror is off", () => {
    const store = fakeBrowser();
    createCookieStorage({ mirrorToLocalStorage: false }).setItem(KEY, '{"a":1}');
    expect(store.has(KEY)).toBe(false);
    expect(jar.size).toBe(1);
  });

  it("treats a corrupted cookie as no session instead of throwing", () => {
    jar.set(KEY, "b64.@@@not-base64@@@");
    const s = createCookieStorage({ mirrorToLocalStorage: true });
    expect(s.getItem(KEY)).toBeNull();
    expect(jar.size).toBe(0); // and cleans up after itself
  });

  it("still reads a value written before base64 encoding existed", () => {
    jar.set(KEY, '{"legacy":true}');
    expect(createCookieStorage({ mirrorToLocalStorage: true }).getItem(KEY)).toBe('{"legacy":true}');
  });
});
