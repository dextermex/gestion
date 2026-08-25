/**
 * Session storage backed by a cookie on the parent domain, so morada.lu and
 * app.morada.lu see the same Supabase session. localStorage is scoped to one
 * origin and can never be shared between the two.
 */

const CHUNK = 3000;              // room under the 4096-byte per-cookie limit
const MAX_CHUNKS = 8;
const ONE_YEAR = 60 * 60 * 24 * 365;
const B64 = "b64.";              // marks an encoded value, so raw ones still read

/** Cookies are shared across subdomains only when scoped to the parent. */
function domainAttr(): string {
  if (typeof window === "undefined") return "";
  const host = window.location.hostname;
  return host === "morada.lu" || host.endsWith(".morada.lu")
    ? "; domain=.morada.lu"
    : ""; // localhost and preview deployments stay host-scoped
}

/**
 * A session is JSON with quotes, braces and accents. Percent-encoding it
 * inflates it unpredictably (up to sixfold on accented text) and blows past
 * the per-cookie limit; base64url inflates by exactly a third and produces
 * only characters a cookie accepts verbatim.
 */
function encode(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return B64 + btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function decode(stored: string): string {
  if (!stored.startsWith(B64)) return stored;
  const binary = atob(stored.slice(B64.length).replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const prefix = `${encodeURIComponent(name)}=`;
  for (const part of document.cookie.split("; ")) {
    if (part.startsWith(prefix)) return part.slice(prefix.length);
  }
  return null;
}

function writeCookie(name: string, value: string, maxAge: number): void {
  if (typeof document === "undefined") return;
  const secure = window.location.protocol === "https:" ? "; secure" : "";
  document.cookie =
    `${encodeURIComponent(name)}=${value}` +
    `; path=/; max-age=${maxAge}; samesite=lax${secure}${domainAttr()}`;
}

function eraseCookie(name: string): void {
  writeCookie(name, "", 0);
}

/**
 * Even base64url, a session runs past the per-cookie limit, so it is split
 * across `<key>.0`, `<key>.1`… and reassembled on read.
 */
export function createCookieStorage(opts: { mirrorToLocalStorage: boolean }) {
  const local = (): Storage | null => {
    try {
      return typeof window === "undefined" ? null : window.localStorage;
    } catch {
      return null; // private browsing with storage disabled
    }
  };

  const readChunked = (key: string): string | null => {
    const whole = readCookie(key);
    if (whole !== null) return whole;
    let out = "";
    for (let i = 0; i < MAX_CHUNKS; i++) {
      const part = readCookie(`${key}.${i}`);
      if (part === null) break;
      out += part;
    }
    return out === "" ? null : out;
  };

  const clearChunks = (key: string): void => {
    eraseCookie(key);
    for (let i = 0; i < MAX_CHUNKS; i++) eraseCookie(`${key}.${i}`);
  };

  const storage = {
    getItem(key: string): string | null {
      const stored = readChunked(key);
      if (stored !== null) {
        try {
          return decode(stored);
        } catch {
          // A truncated or hand-edited cookie reads as "no session" rather
          // than throwing inside the Supabase client.
          clearChunks(key);
          return null;
        }
      }
      // Nobody is logged out by the switch: an existing localStorage session
      // is adopted on first read and promoted to the shared cookie.
      const legacy = local()?.getItem(key) ?? null;
      if (legacy !== null) storage.setItem(key, legacy);
      return legacy;
    },

    setItem(key: string, value: string): void {
      clearChunks(key);
      const encoded = encode(value);
      if (encoded.length <= CHUNK) {
        writeCookie(key, encoded, ONE_YEAR);
      } else {
        for (let i = 0; i * CHUNK < encoded.length; i++) {
          writeCookie(`${key}.${i}`, encoded.slice(i * CHUNK, (i + 1) * CHUNK), ONE_YEAR);
        }
      }
      // Phase 1 keeps localStorage in step, so reverting the deploy logs
      // nobody out. Phase 3 drops this.
      if (opts.mirrorToLocalStorage) {
        try {
          local()?.setItem(key, value);
        } catch {
          /* quota or private browsing — the cookie is the source of truth */
        }
      }
    },

    removeItem(key: string): void {
      clearChunks(key);
      try {
        local()?.removeItem(key);
      } catch {
        /* ignore */
      }
    },
  };

  return storage;
}
