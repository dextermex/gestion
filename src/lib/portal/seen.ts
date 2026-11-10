/**
 * When this browser last showed each tenancy's conversation: a small
 * cookie, so the server can count what is new without a round trip. It
 * holds tenancy ids and timestamps, nothing of the messages themselves,
 * and is only ever read as a hint for the unread badge.
 */
export const SEEN_COOKIE = "morada_tenant_seen";

const ID = /^[0-9a-zA-Z-]{1,64}$/;
const ISO = /^\d{4}-\d{2}-\d{2}T[\d:.]+(Z|[+-]\d{2}:\d{2})?$/;

export function parseSeen(raw: string | undefined | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!raw) return out;
  let text = raw;
  try {
    text = decodeURIComponent(raw);
  } catch {
    return out;
  }
  for (const part of text.split("|").slice(0, 20)) {
    const at = part.indexOf("=");
    if (at <= 0) continue;
    const id = part.slice(0, at);
    const when = part.slice(at + 1);
    if (ID.test(id) && ISO.test(when)) out[id] = when;
  }
  return out;
}

export function serializeSeen(seen: Readonly<Record<string, string>>): string {
  return encodeURIComponent(
    Object.entries(seen)
      .filter(([id, when]) => ID.test(id) && ISO.test(when))
      .slice(-20)
      .map(([id, when]) => `${id}=${when}`)
      .join("|"),
  );
}
