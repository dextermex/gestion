import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { POST } from "@/app/api/locataire/profil/route";
import { addTenantMessage } from "@/lib/portal/requests";
import { withTenant } from "@/lib/portal/session";
import { updateSignupUser } from "@/lib/signup/update-user";
import { authedClient } from "@/lib/supabase/server";

/**
 * The tenant's own account route: same origin only, the session's own
 * identity only, the profile row through its own-row policy, and nothing
 * written to the landlord's file. With `notify`, the manager is told in the
 * tenancy's conversation, in the tenant's name.
 */
vi.mock("@/lib/supabase/server", () => ({ authedClient: vi.fn() }));
vi.mock("@/lib/portal/session", () => ({ withTenant: vi.fn() }));
vi.mock("@/lib/portal/requests", () => ({ addTenantMessage: vi.fn() }));
vi.mock("@/lib/signup/update-user", () => ({ updateSignupUser: vi.fn() }));
vi.mock("@/lib/i18n", async () => {
  const { fr } = await import("@/lib/i18n/fr");
  return { getI18n: async () => ({ locale: "fr", d: fr }) };
});

const USER = { id: "tenant-1", email: "jean.muller@pt.lu", phone: "352621123456" };
let db: ReturnType<typeof database>;
let rpc: ReturnType<typeof vi.fn>;
function database() {
  const query = {
    update: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), select: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: { id: USER.id, first_name: "Jean", last_name: "Muller" }, error: null }),
    then: undefined as unknown,
  };
  return { from: vi.fn(() => query), query, auth: { getUser: vi.fn(async () => ({ data: { user: USER }, error: null })) } };
}
function request(body: unknown, origin = "https://app.morada.lu") {
  return new NextRequest("https://app.morada.lu/api/locataire/profil", { method: "POST", headers: { origin, "Content-Type": "application/json" }, body: JSON.stringify(body) });
}
const details = { action: "details", firstName: "Jean-Pierre", lastName: "Muller" };

beforeEach(() => {
  vi.clearAllMocks();
  db = database();
  rpc = vi.fn(async () => ({ data: [{ lease_id: "l-1", org_id: "o-1", lease_status: "active", start_date: "2023-04-01", unit_label: "Apt 3B", property_name: "Résidence Beaulieu" }], error: null }));
  vi.mocked(authedClient).mockReturnValue(db as unknown as ReturnType<typeof authedClient>);
  vi.mocked(withTenant).mockResolvedValue({ g: { rpc } as never, session: { userId: USER.id, email: USER.email, accessToken: "tenant-token" } });
  vi.mocked(updateSignupUser).mockResolvedValue({ error: null });
  vi.mocked(addTenantMessage).mockResolvedValue({ id: "m-1", conversationId: "c-1" });
});

describe("the tenant's account route", () => {
  it("refuses another origin before reading the session", async () => {
    expect((await POST(request(details, "https://evil.test"))).status).toBe(403);
    expect(withTenant).not.toHaveBeenCalled();
  });

  it("refuses a malformed body and a signed-out caller", async () => {
    expect((await POST(request({ action: "details", firstName: "", lastName: "Muller" }))).status).toBe(400);
    expect((await POST(request({ action: "password", password: "x" }))).status).toBe(400);
    vi.mocked(withTenant).mockResolvedValueOnce(NextResponse.json({ error: "unauthenticated" }, { status: 401 }));
    expect((await POST(request(details))).status).toBe(401);
    expect(db.from).not.toHaveBeenCalled();
  });

  it("saves the name on the caller's own profile row, whatever id the body carries", async () => {
    const res = await POST(request({ ...details, id: "someone-else" }));
    expect(await res.json()).toEqual({ ok: true, notified: false });
    expect(db.from).toHaveBeenCalledWith("profiles");
    expect(db.query.update).toHaveBeenCalledWith({ first_name: "Jean-Pierre", last_name: "Muller" });
    expect(db.query.eq).toHaveBeenCalledWith("id", "tenant-1");
    expect(updateSignupUser).toHaveBeenCalledWith("tenant-token", { data: { first_name: "Jean-Pierre", last_name: "Muller" } });
    expect(addTenantMessage).not.toHaveBeenCalled();
  });

  it("says so when the profile row could not be written, and tells nobody", async () => {
    db.query.maybeSingle.mockResolvedValueOnce({ data: null, error: { message: "RLS denied" } });
    expect((await POST(request({ ...details, notify: true }))).status).toBe(502);
    expect(updateSignupUser).not.toHaveBeenCalled();
    expect(addTenantMessage).not.toHaveBeenCalled();
  });

  it("tells the manager in the tenancy in force, with the account's own details, when asked to", async () => {
    const res = await POST(request({ ...details, notify: true }));
    expect(await res.json()).toEqual({ ok: true, notified: true });
    expect(rpc).toHaveBeenCalledWith("my_home");
    const [, user, lease, text] = vi.mocked(addTenantMessage).mock.calls[0];
    expect(user).toEqual({ id: "tenant-1" });
    expect(lease).toEqual({ id: "l-1", orgId: "o-1", subject: "Apt 3B · Résidence Beaulieu" });
    expect(text).toContain("Jean-Pierre Muller");
    expect(text).toContain("jean.muller@pt.lu");
    expect(text).toContain("+352621123456");
  });

  it("tells nobody when no tenancy is in force", async () => {
    rpc.mockResolvedValueOnce({ data: [{ lease_id: "l-old", org_id: "o-1", lease_status: "ended", start_date: "2020-01-01" }], error: null });
    expect(await (await POST(request({ ...details, notify: true }))).json()).toEqual({ ok: true, notified: false });
    expect(addTenantMessage).not.toHaveBeenCalled();
  });

  it("after a confirmed change, copies the mobile the account system holds, never one from the body", async () => {
    const res = await POST(request({ action: "sync", phone: "+33123456789" }));
    expect(res.status).toBe(200);
    expect(db.query.update).toHaveBeenCalledWith({ phone: "+352621123456" });
    expect(updateSignupUser).not.toHaveBeenCalled();
  });

  it("keeps the chosen language with the profile", async () => {
    db.query.eq.mockResolvedValueOnce({ error: null });
    expect((await POST(request({ action: "locale", locale: "de" }))).status).toBe(200);
    expect(db.query.update).toHaveBeenCalledWith({ preferred_language: "de" });
    expect(updateSignupUser).toHaveBeenCalledWith("tenant-token", { data: { preferred_language: "de" } });
    expect((await POST(request({ action: "locale", locale: "es" }))).status).toBe(400);
  });
});
