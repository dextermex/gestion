import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Property photographs live in a private bucket, so what a row stores is a
 * path, never a URL. Turning paths into links is one batched call per render,
 * made with the caller's own token: the signature is short-lived and the
 * storage policy has already decided whether this account may see the object
 * at all.
 */

export const MEDIA_BUCKET = "gestion-media";

const TTL_SECONDS = 60 * 60;

/** path -> signed URL, for the paths this account is allowed to read. */
export async function signMedia(
  client: SupabaseClient,
  paths: string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const wanted = [...new Set(paths.filter((p) => p && !p.startsWith("http")))];
  if (wanted.length === 0) return out;
  try {
    const { data, error } = await client.storage.from(MEDIA_BUCKET).createSignedUrls(wanted, TTL_SECONDS);
    if (error) {
      console.error("signing property media failed:", error.message);
      return out;
    }
    for (const row of data ?? []) {
      if (row.signedUrl && row.path) out.set(row.path, row.signedUrl);
    }
  } catch (e) {
    // A storage outage must not take the portfolio down: the cards fall back
    // to the drawn placeholder, which is a complete design in its own right.
    console.error("signing property media threw:", e);
  }
  return out;
}
