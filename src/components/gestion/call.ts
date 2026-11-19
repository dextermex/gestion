/**
 * One JSON call from a client action to a gestion route. A session that
 * expired sends the person back through the door (to `backTo`) and returns
 * null; every other answer comes back as it is, for the component to read
 * the code. A form that holds what was typed passes `null` for `backTo`: the
 * 401 then comes back like any other answer, and the form says it and offers
 * to sign in again beside it (src/lib/api-errors.ts) instead of leaving.
 */
export interface CallResult {
  ok: boolean;
  status: number;
  payload: Record<string, unknown>;
}

export async function callJson(url: string, method: string, body: unknown, backTo: string | null): Promise<CallResult | null> {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 401 && backTo !== null) {
    window.location.assign(`/connexion?next=${encodeURIComponent(backTo)}`);
    return null;
  }
  const payload = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: res.ok, status: res.status, payload };
}

/** The same call carrying a form (a file among the fields): the browser sets the boundary. */
export async function callForm(url: string, form: FormData, backTo: string | null): Promise<CallResult | null> {
  const res = await fetch(url, { method: "POST", body: form });
  if (res.status === 401 && backTo !== null) {
    window.location.assign(`/connexion?next=${encodeURIComponent(backTo)}`);
    return null;
  }
  const payload = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: res.ok, status: res.status, payload };
}
