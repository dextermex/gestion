import { beforeEach, describe, expect, it, vi } from "vitest";
import { WORKSPACE_COOKIE } from "@/lib/workspace-cookie";

/**
 * Which workspace an account in several opens: the one its browser names,
 * when the database admits the account there; its first otherwise. The
 * cookie chooses among what the account may already open and nothing else.
 */
let cookie: Record<string, string> = {};
let allowed = new Set<string>();
const agencies = [
  { id: "ag-own", name: "Zoé Thill", kind: "owner" },
  { id: "ag-cabinet", name: "Cabinet Reuter", kind: "manager" },
  { id: "ag-closed", name: "Agence Fermée", kind: "manager" },
];

/** A query that answers the same rows whatever is chained on it, the way the client's builder is awaited. */
const rows = (data: unknown) => {
  const q: Record<string, unknown> = {};
  for (const m of ["select", "eq", "in", "order", "limit"]) q[m] = () => q;
  q.maybeSingle = async () => ({ data: Array.isArray(data) ? (data[0] ?? null) : data, error: null });
  q.then = (resolve: (v: unknown) => void) => resolve({ data, error: null });
  return q;
};
vi.mock("next/headers", () => ({ cookies: async () => ({ get: (name: string) => (cookie[name] ? { value: cookie[name] } : undefined) }) }));
vi.mock("@/lib/supabase/server", () => ({
  getSession: async () => ({ userId: "u-1", email: "zoe@example.invalid", accessToken: "t", metadata: {} }),
  authedClient: () => ({
    from: (table: string) =>
      table === "profiles" ? rows({ first_name: "Zoé", last_name: "Thill" }) : table === "crm_members" ? rows(agencies.map((a) => ({ agency_id: a.id, role: a.id === "ag-own" ? "owner" : "agent" }))) : rows(agencies),
    rpc: async (_fn: string, args: { p_agency: string }) => ({ data: allowed.has(args.p_agency), error: null }),
  }),
}));

const active = async () => {
  vi.resetModules();
  const { getIdentity } = await import("@/lib/workspace");
  return (await getIdentity())!.active;
};

beforeEach(() => {
  cookie = {};
  allowed = new Set(["ag-own", "ag-cabinet"]);
});

describe("the workspace an account opens", () => {
  it("is the first by name when the browser names none", async () => {
    expect((await active())?.id).toBe("ag-cabinet");
  });
  it("is the one the browser names, among those the account may open", async () => {
    cookie[WORKSPACE_COOKIE] = "ag-own";
    expect((await active())?.id).toBe("ag-own");
  });
  it("is never one the database refuses the account, nor one it is not a member of", async () => {
    cookie[WORKSPACE_COOKIE] = "ag-closed";
    expect((await active())?.id).toBe("ag-cabinet");
    cookie[WORKSPACE_COOKIE] = "someone-elses";
    expect((await active())?.id).toBe("ag-cabinet");
  });
  it("is the only one there is, whatever the browser says", async () => {
    allowed = new Set(["ag-own"]);
    cookie[WORKSPACE_COOKIE] = "ag-cabinet";
    expect((await active())?.id).toBe("ag-own");
  });
});
