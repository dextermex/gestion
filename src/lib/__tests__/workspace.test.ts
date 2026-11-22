import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * Which management space a person works in: the one they chose, when it is
 * still theirs; otherwise the first, in an order that never depends on the
 * database. A space is created only when "this account has none" is a fact,
 * never because a read failed, and never the agency of a member whose role
 * opens nothing here.
 */
let chosen: string | undefined;
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (name === "morada_workspace" && chosen !== undefined ? { name, value: chosen } : undefined) }),
  headers: async () => new Headers({ host: "app.morada.lu", "x-forwarded-proto": "https", origin: "https://app.morada.lu" }),
}));
vi.mock("@/lib/supabase/server", () => ({ getSession: vi.fn(), authedClient: vi.fn() }));

import { POST as chooseWorkspace } from "@/app/api/espace/actif/route";
import { authedClient, getSession } from "@/lib/supabase/server";
import { WORKSPACE_COOKIE, getIdentity, hadWorkspace, pickActive, provisionDefaultWorkspace, tenantAnswer } from "@/lib/workspace";

const A = "0a000000-0000-4000-8000-00000000000a";
const B = "0b000000-0000-4000-8000-00000000000b";
const C = "0c000000-0000-4000-8000-00000000000c";
const AGENCY = "0d000000-0000-4000-8000-00000000000d";
type Row = Record<string, unknown>;

interface State {
  memberships: Row[];
  agencies: Row[];
  allowed: Set<string>;
  failing: Set<string>;
  onboarded: number;
}
let state: State;

function fakeDb() {
  const result = (table: string, filters: Row): { data: Row[] | null; error: { code: string; message: string } | null } => {
    if (state.failing.has(table)) return { data: null, error: { code: "57014", message: "timeout" } };
    if (table === "profiles") return { data: [{ first_name: "Anne", last_name: "Weber" }], error: null };
    if (table === "crm_members") return { data: state.memberships, error: null };
    if (table === "agencies") return { data: state.agencies.filter((a) => (filters.id as string[]).includes(String(a.id))), error: null };
    return { data: [], error: null };
  };
  const query = (table: string) => {
    const filters: Row = {};
    const q = {
      select: () => q,
      eq: (k: string, v: unknown) => ((filters[k] = v), q),
      in: (k: string, v: unknown) => ((filters[k] = v), q),
      limit: () => q,
      abortSignal: () => q,
      maybeSingle: async () => {
        const r = result(table, filters);
        return { data: r.data?.[0] ?? null, error: r.error };
      },
      then: (resolve: (value: unknown) => unknown) => Promise.resolve(result(table, filters)).then(resolve),
    };
    return q;
  };
  const rpc = (fn: string, args: Row = {}) => {
    const answer = async () => {
      if (state.failing.has(fn)) return { data: null, error: { code: "57014", message: "timeout" } };
      if (fn === "crm_has_perm") return { data: state.allowed.has(String(args.p_agency)), error: null };
      if (fn === "is_tenant") return { data: false, error: null };
      if (fn === "gestion_onboard") {
        state.onboarded += 1;
        state.memberships.push({ agency_id: C, role: "owner" });
        state.agencies.push({ id: C, name: String(args.p_name), kind: "owner", created_at: "2026-11-19T10:00:00Z" });
        state.allowed.add(C);
        return { data: C, error: null };
      }
      return { data: null, error: { code: "PGRST202", message: "missing" } };
    };
    const call = { abortSignal: () => call, then: (resolve: (value: unknown) => unknown) => answer().then(resolve) };
    return call;
  };
  return { from: query, rpc, schema: () => ({ rpc }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  chosen = undefined;
  state = {
    memberships: [{ agency_id: B, role: "manager" }, { agency_id: A, role: "owner" }],
    agencies: [
      { id: B, name: "Cabinet Weber", kind: "manager", created_at: "2026-03-01T10:00:00Z" },
      { id: A, name: "Anne Weber", kind: "owner", created_at: "2026-01-01T10:00:00Z" },
    ],
    allowed: new Set([A, B]),
    failing: new Set(),
    onboarded: 0,
  };
  vi.mocked(getSession).mockResolvedValue({ userId: "user-1", email: "anne@example.lu", accessToken: "token", metadata: {} });
  vi.mocked(authedClient).mockImplementation(() => fakeDb() as never);
});

describe("the workspace on screen", () => {
  it("is the first by name when nothing was chosen", async () => {
    const identity = await getIdentity();
    expect(identity?.workspaces.map((w) => w.name)).toEqual(["Anne Weber", "Cabinet Weber"]);
    expect(identity?.active?.id).toBe(A);
    expect(identity?.membershipUnread).toBeUndefined();
  });

  it("is the one the person chose, as long as it is theirs", async () => {
    chosen = B;
    const identity = await getIdentity();
    expect(identity?.active).toEqual({ id: B, name: "Cabinet Weber", kind: "manager", role: "manager" });
  });

  it("ignores a choice that names a workspace of somebody else, a workspace the role does not open, or anything malformed", async () => {
    for (const value of [C, AGENCY, "not-a-uuid", "../../etc", ""]) {
      chosen = value;
      expect((await getIdentity())?.active?.id, value).toBe(A);
    }
    state.allowed = new Set([A]);
    chosen = B;
    const identity = await getIdentity();
    expect(identity?.workspaces.map((w) => w.id)).toEqual([A]);
    expect(identity?.active?.id).toBe(A);
  });

  it("orders two workspaces of the same name by age, whatever order the database returns", async () => {
    state.agencies = [
      { id: B, name: "Weber", kind: "owner", created_at: "2026-06-01T10:00:00Z" },
      { id: A, name: "Weber", kind: "owner", created_at: "2026-07-01T10:00:00Z" },
    ];
    expect((await getIdentity())?.active?.id).toBe(B);
    state.agencies.reverse();
    expect((await getIdentity())?.active?.id).toBe(B);
  });

  it("says when the memberships could not be read, instead of calling it no workspace", async () => {
    for (const failing of ["crm_members", "agencies", "crm_has_perm"]) {
      state.failing = new Set([failing]);
      const identity = await getIdentity();
      expect(identity?.active, failing).toBeNull();
      expect(identity?.membershipUnread, failing).toBe(true);
    }
    // No membership at all, read without fault, is a fact.
    state.failing = new Set();
    state.memberships = [];
    const identity = await getIdentity();
    expect(identity?.active).toBeNull();
    expect(identity?.membershipUnread).toBeUndefined();
  });

  it("is chosen by a pure rule", () => {
    const list = [{ id: A, name: "a", kind: "owner", role: "owner" }, { id: B, name: "b", kind: "owner", role: "viewer" }];
    expect(pickActive(list, B)?.id).toBe(B);
    expect(pickActive(list, C)?.id).toBe(A);
    expect(pickActive(list, null)?.id).toBe(A);
    expect(pickActive([], A)).toBeNull();
  });
});

describe("the first management space", () => {
  it("is created for an account that has none", async () => {
    state.memberships = [];
    state.agencies = [];
    state.allowed = new Set();
    const identity = await provisionDefaultWorkspace();
    expect(state.onboarded).toBe(1);
    expect(identity?.active).toEqual({ id: C, name: "Anne Weber", kind: "owner", role: "owner" });
  });

  it("is not created again for an account that already has one", async () => {
    const identity = await provisionDefaultWorkspace();
    expect(state.onboarded).toBe(0);
    expect(identity?.active?.id).toBe(A);
  });

  it("is the member's own when their only membership opens nothing here: never the agency's name over empty screens", async () => {
    state.memberships = [{ agency_id: AGENCY, role: "agent" }];
    state.agencies = [{ id: AGENCY, name: "Agence Immo", kind: "agency", created_at: "2025-01-01T10:00:00Z" }];
    state.allowed = new Set();
    expect((await getIdentity())?.workspaces).toEqual([]);
    const identity = await provisionDefaultWorkspace();
    expect(state.onboarded).toBe(1);
    expect(identity?.workspaces.map((w) => w.id)).toEqual([C]);
    expect(identity?.active?.name).toBe("Anne Weber");
  });

  it("is never created because a read failed", async () => {
    for (const failing of ["crm_members", "agencies", "crm_has_perm"]) {
      state.failing = new Set([failing]);
      expect(await provisionDefaultWorkspace(), failing).toBeNull();
    }
    expect(state.onboarded).toBe(0);
  });

  it("knows an account that has had one, from the note left on the account", () => {
    expect(hadWorkspace(undefined)).toBe(false);
    expect(hadWorkspace({})).toBe(false);
    expect(hadWorkspace({ morada_account: { workspace_seen_at: "" } })).toBe(false);
    expect(hadWorkspace({ morada_account: { workspace_seen_at: "2026-11-19T10:00:00.000Z" } })).toBe(true);
  });

  it("does not take a failed tenant lookup for a no", async () => {
    expect(await tenantAnswer("token")).toBe(false);
    state.failing = new Set(["is_tenant"]);
    expect(await tenantAnswer("token")).toBeNull();
  });
});

describe("choosing the workspace", () => {
  const ask = (workspaceId: unknown, origin = "https://app.morada.lu") =>
    chooseWorkspace(new NextRequest("https://app.morada.lu/api/espace/actif", { method: "POST", headers: { origin, "Content-Type": "application/json" }, body: JSON.stringify({ workspaceId }) }));

  it("is kept in a cookie scripts cannot read, for a workspace of the person's own", async () => {
    const res = await ask(B);
    expect(res.status).toBe(200);
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toContain(`${WORKSPACE_COOKIE}=${B}`);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=lax/i);
    expect(cookie).toMatch(/Secure/i);
    expect(cookie).toMatch(/Path=\//);
    expect(cookie).not.toMatch(/Domain=/i);
  });

  it("is refused for a workspace that is not the person's, a malformed id, another origin and a signed-out caller", async () => {
    for (const id of [C, AGENCY]) {
      const res = await ask(id);
      expect(res.status, id).toBe(404);
      expect(res.headers.get("set-cookie")).toBeNull();
    }
    expect((await ask("nope")).status).toBe(400);
    expect((await ask(undefined)).status).toBe(400);
    expect((await ask(B, "https://morada.lu")).status).toBe(403);
    vi.mocked(getSession).mockResolvedValue(null);
    expect((await ask(B)).status).toBe(401);
  });
});
