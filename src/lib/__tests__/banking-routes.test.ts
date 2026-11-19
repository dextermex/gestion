import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

/**
 * The bank routes: the diagnosis answers only a member who may edit the
 * workspace's finances and tells nobody else anything about the deployment;
 * a journey is opened, and the provider read back, only by such a member, in
 * a workspace that is not locked, a counted number of times; and a provider
 * that does not answer is said as such.
 */
let requestHeaders: Record<string, string>;
vi.mock("next/headers", () => ({ headers: async () => new Headers(requestHeaders) }));
vi.mock("@/lib/supabase/server", () => ({ getSession: vi.fn(), authedClient: vi.fn() }));
vi.mock("@/lib/workspace", () => ({ getIdentity: vi.fn() }));
vi.mock("@/lib/billing/gate", () => ({ refuseWhenLocked: vi.fn() }));
vi.mock("@/lib/demo", () => ({ DATASET_COOKIE: "morada_dataset", sampleDataEnabled: vi.fn(() => false) }));
vi.mock("@/lib/banking/reconcile", () => ({ reconcileUnmatched: vi.fn(async () => 0) }));
vi.mock("@/lib/banking/saltedge", async () => {
  class SaltEdgeError extends Error {
    constructor(public readonly code: string, message: string) {
      super(message);
    }
  }
  return {
    SaltEdgeError,
    saltEdgeConfigured: vi.fn(() => true),
    saltEdgeProbe: vi.fn(async () => ({ ok: true })),
    fakeProvidersWanted: vi.fn(() => false),
    demoProviderCode: vi.fn(() => "fakebank_simple_xf"),
    returnToFor: (origin: string) => `${origin}/app/banque/retour`,
    registerCustomer: vi.fn(async () => undefined),
    createConnectSession: vi.fn(async () => "https://www.saltedge.com/connect/abc"),
    ensureCustomer: vi.fn(async () => "cust-1"),
    listConnections: vi.fn(async () => []),
    listAccounts: vi.fn(async () => []),
    listTransactions: vi.fn(async () => []),
  };
});

import { GET as health } from "@/app/api/banking/health/route";
import { POST as connect } from "@/app/api/banking/connect/route";
import { POST as sync } from "@/app/api/banking/sync/route";
import { SaltEdgeError, createConnectSession, ensureCustomer, registerCustomer, saltEdgeProbe } from "@/lib/banking/saltedge";
import { refuseWhenLocked } from "@/lib/billing/gate";
import { sampleDataEnabled } from "@/lib/demo";
import { authedClient, getSession } from "@/lib/supabase/server";
import { getIdentity } from "@/lib/workspace";

const APP = "https://app.morada.lu";
const ORG = { id: "0b7e3c1a-4d55-4f0e-9a41-2f5d8c6b7a10", name: "Cabinet", kind: "manager", role: "manager" };
let permissions: Set<string>;
let withinLimit: boolean;
const rpc = vi.fn(async (fn: string, args: Record<string, unknown>) => {
  if (fn === "can") return { data: permissions.has(String(args.p_perm)), error: null };
  if (fn === "rate_take") return { data: withinLimit, error: null };
  return { data: null, error: { code: "PGRST202" } };
});
const post = (path: string, headers: Record<string, string> = { origin: APP }) => new NextRequest(`${APP}${path}`, { method: "POST", headers });

beforeEach(() => {
  vi.clearAllMocks();
  requestHeaders = { host: "app.morada.lu", "x-forwarded-proto": "https", origin: APP };
  permissions = new Set(["gestion.finance.edit"]);
  withinLimit = true;
  vi.mocked(getSession).mockResolvedValue({ userId: "user-1", email: "anne@example.lu", accessToken: "token" });
  vi.mocked(getIdentity).mockResolvedValue({ userId: "user-1", email: "anne@example.lu", displayName: "Anne", workspaces: [ORG], active: ORG });
  vi.mocked(refuseWhenLocked).mockResolvedValue(null);
  vi.mocked(authedClient).mockReturnValue({ schema: () => ({ rpc }) } as never);
  vi.mocked(sampleDataEnabled).mockReturnValue(false);
});

describe("the bank connection's diagnosis", () => {
  const get = () => health(new NextRequest(`${APP}/api/banking/health`));
  const DEPLOYMENT = /deployedCommit|vercelEnv|saltedge|returnTo|VariableNames|deployedAt/;

  it("tells a stranger nothing, and does not ask the provider", async () => {
    requestHeaders = { host: "app.morada.lu", "x-forwarded-proto": "https" };
    vi.mocked(getSession).mockResolvedValue(null);
    const res = await get();
    expect(res.status).toBe(401);
    expect(JSON.stringify(await res.json())).not.toMatch(DEPLOYMENT);
    expect(saltEdgeProbe).not.toHaveBeenCalled();
  });

  it("refuses an account without a workspace and a member who may not edit the finances", async () => {
    vi.mocked(getIdentity).mockResolvedValueOnce({ userId: "user-1", email: "", displayName: "", workspaces: [], active: null });
    expect((await get()).status).toBe(403);
    permissions = new Set(["gestion.properties.view", "gestion.finance.view"]);
    const res = await get();
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "forbidden", permission: "gestion.finance.edit" });
    expect(saltEdgeProbe).not.toHaveBeenCalled();
  });

  it("answers a member who may, without any variable's name or the deployment's id, and counts the call", async () => {
    vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "0123456789abcdef");
    vi.stubEnv("VERCEL_DEPLOYMENT_ID", "dpl_secret");
    vi.stubEnv("SALTEDGE_APP_ID", "app-id-value");
    vi.stubEnv("SALTEDGE_SECRET", "secret-value");
    try {
      const res = await get();
      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBe("no-store");
      const body = await res.json();
      expect(body).toEqual({ deployedCommit: "0123456", vercelEnv: null, saltedgeAppIdPresent: true, saltedgeSecretPresent: true, fakeProviders: false, returnTo: `${APP}/app/banque/retour`, saltedge: { ok: true } });
      const text = JSON.stringify(body);
      expect(text).not.toContain("dpl_secret");
      expect(text).not.toContain("app-id-value");
      expect(text).not.toContain("secret-value");
      expect(text).not.toContain("SALTEDGE_");
      expect(rpc).toHaveBeenCalledWith("rate_take", expect.objectContaining({ p_action: "bank.probe", p_org: ORG.id }));
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("answers 429 over the limit, before asking the provider", async () => {
    withinLimit = false;
    const res = await get();
    expect(res.status).toBe(429);
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0);
    expect((await res.json()).error).toBe("rate_limited");
    expect(saltEdgeProbe).not.toHaveBeenCalled();
  });
});

describe("opening a bank-consent journey", () => {
  it("is refused from another origin, without one, and signed out", async () => {
    expect((await connect(post("/api/banking/connect", { origin: "https://morada.lu" }))).status).toBe(403);
    expect((await connect(post("/api/banking/connect", {}))).status).toBe(403);
    expect(getSession).not.toHaveBeenCalled();
    vi.mocked(getSession).mockResolvedValue(null);
    expect((await connect(post("/api/banking/connect"))).status).toBe(401);
    expect(registerCustomer).not.toHaveBeenCalled();
  });

  it("is refused to a member who may not edit the finances, in a locked workspace, and over the limit: the provider is never called", async () => {
    permissions = new Set(["gestion.properties.view"]);
    const viewer = await connect(post("/api/banking/connect"));
    expect(viewer.status).toBe(403);
    expect(await viewer.json()).toEqual({ error: "forbidden", permission: "gestion.finance.edit" });

    permissions = new Set(["gestion.finance.edit"]);
    vi.mocked(refuseWhenLocked).mockResolvedValueOnce(NextResponse.json({ error: "subscription_required" }, { status: 402 }));
    expect((await connect(post("/api/banking/connect"))).status).toBe(402);

    withinLimit = false;
    expect((await connect(post("/api/banking/connect"))).status).toBe(429);
    expect(registerCustomer).not.toHaveBeenCalled();
    expect(createConnectSession).not.toHaveBeenCalled();
  });

  it("opens the journey for the workspace, counted on the person and the workspace", async () => {
    const res = await connect(post("/api/banking/connect"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ url: "https://www.saltedge.com/connect/abc" });
    expect(registerCustomer).toHaveBeenCalledWith(`morada-ws-${ORG.id}`);
    expect(rpc).toHaveBeenCalledWith("rate_take", expect.objectContaining({ p_action: "bank.connect", p_org: ORG.id, p_user_max: 10, p_org_max: 20 }));
  });

  it("counts the sample journey on the person alone", async () => {
    vi.mocked(sampleDataEnabled).mockReturnValue(true);
    const res = await connect(post("/api/banking/connect", { origin: APP, cookie: "morada_dataset=fr" }));
    expect(await res.json()).toEqual({ url: "https://www.saltedge.com/connect/abc", demo: true });
    expect(rpc).toHaveBeenCalledWith("rate_take", expect.objectContaining({ p_action: "bank.connect", p_org: null, p_org_max: null }));
    expect(rpc).not.toHaveBeenCalledWith("can", expect.anything());
  });

  it("names a provider that did not answer in time, and never hands back its message", async () => {
    vi.mocked(createConnectSession).mockRejectedValueOnce(new SaltEdgeError("timeout", "the provider did not answer in time"));
    const slow = await connect(post("/api/banking/connect"));
    expect(slow.status).toBe(504);
    expect(await slow.json()).toEqual({ error: "saltedge_error", code: "timeout" });
    vi.mocked(createConnectSession).mockRejectedValueOnce(new SaltEdgeError("WrongSecret", "secret abc is wrong"));
    const refused = await connect(post("/api/banking/connect"));
    expect(refused.status).toBe(502);
    expect(JSON.stringify(await refused.json())).not.toContain("abc");
  });
});

describe("reading the provider back", () => {
  it("is a write: this application's pages, an unlocked workspace, a member who may edit the finances, a counted run", async () => {
    requestHeaders = { host: "app.morada.lu", "x-forwarded-proto": "https" };
    expect((await sync()).status).toBe(403);
    requestHeaders = { host: "app.morada.lu", "x-forwarded-proto": "https", origin: APP };

    vi.mocked(refuseWhenLocked).mockResolvedValueOnce(NextResponse.json({ error: "subscription_required" }, { status: 402 }));
    expect((await sync()).status).toBe(402);

    permissions = new Set(["gestion.finance.view"]);
    expect((await sync()).status).toBe(403);
    permissions = new Set(["gestion.finance.edit"]);

    withinLimit = false;
    expect((await sync()).status).toBe(429);
    expect(ensureCustomer).not.toHaveBeenCalled();

    withinLimit = true;
    const res = await sync();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ connections: 0, accounts: 0, transactions: 0, matched: 0 });
    expect(rpc).toHaveBeenCalledWith("rate_take", expect.objectContaining({ p_action: "bank.sync", p_org: ORG.id }));
  });

  it("says when the provider did not answer in time", async () => {
    vi.mocked(ensureCustomer).mockRejectedValueOnce(new SaltEdgeError("timeout", "slow"));
    const res = await sync();
    expect(res.status).toBe(504);
    expect(await res.json()).toEqual({ error: "saltedge_error", code: "timeout" });
  });
});
