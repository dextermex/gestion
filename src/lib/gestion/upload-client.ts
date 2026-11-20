import { callForm, callJson, type CallResult } from "@/components/gestion/call";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "@/lib/supabase/config";

/**
 * A piece sent to the register from a screen, whatever its size. A request
 * to the application carries a few megabytes at most: the host refuses a
 * larger body before any route runs, with an answer no screen can explain.
 * So a file up to that size travels in the request, as it always did, and a
 * larger one (a scanned lease, a syndic's statement) goes from the browser
 * straight to the private bucket with a one-time token the application
 * signs under the person's own session, then is registered by its path.
 * Either way the answer is the register's: the piece's id, or the reason
 * it was refused.
 */
export const IN_REQUEST_MAX_BYTES = 4 * 1024 * 1024;

/**
 * The file put in the workspace's folder of the bucket by the browser
 * itself, with a one-time token the application signs under the person's
 * own session: the path it now has, or the refusal (a type or a size the
 * register does not take, the storage service's own answer). Null when the
 * session ended and the person is on the way to signing in again.
 */
export async function putInBucket(file: File, backTo: string): Promise<{ path: string } | CallResult | null> {
  const target = await callJson("/api/documents/televersement", "POST", { type: file.type, size: file.size }, backTo);
  if (!target || !target.ok) return target;
  const { bucket, path, token } = target.payload as { bucket?: string; path?: string; token?: string };
  if (!bucket || !path || !token) return { ok: false, status: 502, payload: { error: "upload_failed" } };
  // The storage service's own signed upload: the token is the permission, no session travels with the file.
  const body = new FormData();
  body.append("cacheControl", "3600");
  body.append("", file);
  // The project's public key opens the storage gateway, as for any browser client; the token decides.
  const put = await fetch(`${SUPABASE_URL}/storage/v1/object/upload/sign/${bucket}/${path}?token=${encodeURIComponent(token)}`, {
    method: "PUT",
    headers: { "x-upsert": "false", apikey: SUPABASE_ANON_KEY },
    body,
  }).catch(() => null);
  if (!put || !put.ok) return { ok: false, status: put?.status === 413 ? 413 : 502, payload: { error: put?.status === 413 ? "too_large" : "upload_failed" } };
  return { path };
}

export async function uploadPiece(file: File, fields: Record<string, string>, backTo: string): Promise<CallResult | null> {
  if (file.size <= IN_REQUEST_MAX_BYTES) {
    const form = new FormData();
    form.set("file", file);
    for (const [key, value] of Object.entries(fields)) form.set(key, value);
    return callForm("/api/documents", form, backTo);
  }
  const put = await putInBucket(file, backTo);
  if (!put || !("path" in put)) return put;
  return callJson("/api/documents", "POST", { uploadedPath: put.path, ...fields }, backTo);
}
