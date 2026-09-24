/**
 * One JSON call from a client action to a gestion route. A session that
 * expired sends the person back through the door and returns null; every
 * other answer comes back as it is, for the component to read the code.
 */
export interface CallResult {
  ok: boolean;
  status: number;
  payload: Record<string, unknown>;
}

export async function callJson(url: string, method: string, body: unknown, backTo: string): Promise<CallResult | null> {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 401) {
    window.location.assign(`/connexion?next=${encodeURIComponent(backTo)}`);
    return null;
  }
  const payload = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: res.ok, status: res.status, payload };
}
