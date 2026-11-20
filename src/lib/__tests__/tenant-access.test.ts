import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * A tenant's access to their space can be withdrawn: the link between the
 * contact and the account is cleared (the database lets a manager clear it,
 * never set it) and the invitations still waiting are revoked, so nothing
 * reopens the space but a new invitation. Only a member who may edit the
 * tenants does it, from the application's own pages.
 */
const sent = vi.hoisted(() => ({ origin: "https://app.morada.lu" }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ host: "app.morada.lu", "x-forwarded-proto": "https", origin: sent.origin }) }));
vi.mock("@/lib/supabase/server", () => ({ getSession: vi.fn(), authedClient: vi.fn() }));
vi.mock("@/lib/workspace", () => ({ getIdentity: vi.fn() }));
vi.mock("@/lib/billing/gate", () => ({ refuseWhenLocked: vi.fn(async () => null) }));

import { DELETE as withdraw } from "@/app/api/contacts/[id]/acces/route";
import { refuseWhenLocked } from "@/lib/billing/gate";
import { authedClient, getSession } from "@/lib/supabase/server";
import { getIdentity } from "@/lib/workspace";
import { fr } from "@/lib/i18n/fr";
import { partyInvitations } from "@/lib/portal/owner";

const ORG = { id: "0b7e3c1a-4d55-4f0e-9a41-2f5d8c6b7a10", name: "Cabinet", kind: "manager", role: "manager" };
const ID = "5c1d2e3f-0a1b-4c2d-8e3f-4a5b6c7d8e9f";
type Row = Record<string, unknown>;

let permissions: Set<string>;
let contact: Row | null;
let invites: Row[];
let updates: Array<{ values: unknown; filters: Row }>;
let revoked: string[];

function gestion() {
  const from = (table: string) => {
    const filters: Row = {};
    let op = "select";
    let values: unknown;
    const rows = (): Row[] => (table === "contacts" ? (contact && contact.id === filters.id && filters.org_id === ORG.id ? [contact] : []) : invites);
    const q = {
      select: () => q,
      update: (v: unknown) => ((op = "update"), (values = v), q),
      eq: (k: string, v: unknown) => ((filters[k] = v), q),
      is: () => q,
      gt: () => q,
      maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
      then: (resolve: (v: unknown) => unknown) => {
        if (op === "update") {
          updates.push({ values, filters: { ...filters } });
          const hit = rows();
          if (contact && hit.length) contact = { ...contact, ...(values as Row) };
          return Promise.resolve({ data: hit.map((r) => ({ id: r.id })), error: null }).then(resolve);
        }
        return Promise.resolve({ data: rows(), error: null }).then(resolve);
      },
    };
    return q;
  };
  const rpc = async (fn: string, args: Row) => {
    if (fn === "can") return { data: permissions.has(String(args.p_perm)), error: null };
    if (fn === "portal_revoke") revoked.push(String(args.p_invite));
    return { data: null, error: null };
  };
  return { from, rpc };
}
const call = (id = ID, origin = "https://app.morada.lu") =>
  ((sent.origin = origin), withdraw)(new NextRequest(`https://app.morada.lu/api/contacts/${id}/acces`, { method: "DELETE", headers: { origin } }), { params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  permissions = new Set(["gestion.tenants.edit"]);
  contact = { id: ID, user_id: "a1b2c3d4-0000-4000-8000-00000000aaaa" };
  invites = [];
  updates = [];
  revoked = [];
  vi.mocked(getSession).mockResolvedValue({ userId: "user-1", email: "anne@example.lu", accessToken: "token" } as never);
  vi.mocked(getIdentity).mockResolvedValue({ userId: "user-1", email: "anne@example.lu", displayName: "Anne", workspaces: [ORG], active: ORG } as never);
  vi.mocked(authedClient).mockReturnValue({ schema: () => gestion() } as never);
});

describe("withdrawing a tenant's access", () => {
  it("clears the link between the contact and the account, and revokes the invitations still waiting", async () => {
    invites = [{ id: "inv-1" }, { id: "inv-2" }];
    const res = await call();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, withdrawn: true, revoked: 2 });
    expect(updates).toEqual([{ values: { user_id: null }, filters: { id: ID, org_id: ORG.id } }]);
    expect(revoked).toEqual(["inv-1", "inv-2"]);
    expect(contact?.user_id).toBeNull();
  });

  it("stays open after the trial, like revoking an invitation", async () => {
    await call();
    expect(refuseWhenLocked).not.toHaveBeenCalled();
  });

  it("answers that nothing changed when nothing was open or waiting", async () => {
    contact = { id: ID, user_id: null };
    const res = await call();
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "not_linked" });
    expect(updates).toHaveLength(0);
  });

  it("refuses a role that may not edit the tenants, in words, before anything is written", async () => {
    permissions = new Set(["gestion.tenants.view"]);
    const res = await call();
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "forbidden", permission: "gestion.tenants.edit" });
    expect(updates).toHaveLength(0);
  });

  it("finds no contact of another workspace, refuses an id that is not one, and a request from elsewhere", async () => {
    contact = { id: "6c1d2e3f-0a1b-4c2d-8e3f-4a5b6c7d8e9f", user_id: "x" };
    expect((await call()).status).toBe(404);
    expect((await call("not-an-id")).status).toBe(400);
    expect((await call(ID, "https://evil.example")).status).toBe(403);
    expect(updates).toHaveLength(0);
  });
});

describe("the desk's view of a tenant whose access was withdrawn", () => {
  const invite = { id: "inv-1", contactId: "c-1", leaseId: "l-1", email: "jean@example.lu", expiresAt: "2026-12-01T00:00:00Z", acceptedAt: "2026-11-02T09:00:00Z", revokedAt: null, sentAt: "2026-11-01T09:00:00Z", delivery: "email" as const, createdAt: "2026-11-01T09:00:00Z" };
  const lease = { id: "l-1", status: "active", tenantContactIds: ["c-1"] };
  const view = (portalLinked: boolean) =>
    partyInvitations({ INVITES: [invite], TODAY: "2026-11-20", contactById: () => ({ id: "c-1", name: "Jean Muller", email: "jean@example.lu", portalLinked }) }, lease, fr, "fr", false)[0];

  it("shows a linked account as open, and offers no invitation", () => {
    const linked = view(true);
    expect(linked).toMatchObject({ state: "accepted", linked: true, canInvite: false });
  });

  it("shows a withdrawn access as closed, says so, and offers a new invitation", () => {
    const closed = view(false);
    expect(closed).toMatchObject({ state: "revoked", linked: false, canInvite: true, detail: fr.baux.portalWithdrawn });
  });
});
