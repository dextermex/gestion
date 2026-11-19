/**
 * One JSON call from a client action to a gestion route. The server renews
 * a session at its end by itself, so a 401 means it could not; the browser
 * then tries its own renewal once and sends the same call again. Only when
 * that fails too is the person sent back through the door, to return where
 * they were, and null comes back. Every other answer comes back as it is,
 * for the component to read the code.
 */
export interface CallResult {
  ok: boolean;
  status: number;
  payload: Record<string, unknown>;
}

/** The call, and once more after a renewal when the first answer was "signed out". Nothing was done by a call answered 401. */
async function sendKeepingSession(url: string, init: () => RequestInit): Promise<Response> {
  const res = await fetch(url, init());
  if (res.status !== 401) return res;
  const renewed = await import("@/lib/supabase/browser").then((m) => m.renewSessionNow()).catch(() => false);
  return renewed ? fetch(url, init()) : res;
}

export async function callJson(url: string, method: string, body: unknown, backTo: string): Promise<CallResult | null> {
  const res = await sendKeepingSession(url, () => ({
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  }));
  if (res.status === 401) {
    window.location.assign(`/connexion?next=${encodeURIComponent(backTo)}`);
    return null;
  }
  const payload = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: res.ok, status: res.status, payload };
}

/** The same call carrying a form (a file among the fields): the browser sets the boundary. */
export async function callForm(url: string, form: FormData, backTo: string): Promise<CallResult | null> {
  const res = await sendKeepingSession(url, () => ({ method: "POST", body: form }));
  if (res.status === 401) {
    window.location.assign(`/connexion?next=${encodeURIComponent(backTo)}`);
    return null;
  }
  const payload = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: res.ok, status: res.status, payload };
}
