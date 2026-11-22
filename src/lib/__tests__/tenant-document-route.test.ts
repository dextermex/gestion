import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { GestionReader } from "@/lib/demo/data-real";

/**
 * A tenant opens a piece of their tenancy through a route that signs it for
 * a minute at that moment; the pages that list the pieces carry the route's
 * address, never a signed link, and only for a piece whose file can be read.
 */
vi.mock("next/headers", () => ({ headers: async () => new Headers({ host: "app.morada.lu", "x-forwarded-proto": "https" }) }));
vi.mock("@/lib/supabase/server", () => ({ getSession: vi.fn(), authedClient: vi.fn() }));
vi.mock("@/lib/gestion/documents", () => ({ signedDocumentUrl: vi.fn() }));

import { GET } from "@/app/api/locataire/documents/[id]/fichier/route";
import { signedDocumentUrl } from "@/lib/gestion/documents";
import { buildTenantSpace, tenantDocumentHref } from "@/lib/portal/tenant-space";
import { authedClient, getSession } from "@/lib/supabase/server";

const DOC = "5c1d2e3f-0a1b-4c2d-8e3f-4a5b6c7d8e9f";
let readable: Record<string, unknown> | null;
const open = (id: string) => GET(new NextRequest(`https://app.morada.lu/api/locataire/documents/${id}/fichier`), { params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  readable = { id: DOC, name: "Bail.pdf", storage_path: "org/documents/x.pdf" };
  vi.mocked(getSession).mockResolvedValue({ userId: "u-t", email: "t@example.test", accessToken: "token" } as never);
  const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: readable, error: null }) };
  vi.mocked(authedClient).mockReturnValue({ schema: () => ({ from: () => q }) } as never);
  vi.mocked(signedDocumentUrl).mockResolvedValue("https://storage.example/signed?token=short");
});

describe("opening a tenant's piece", () => {
  it("hands over a link signed at that moment", async () => {
    const res = await open(DOC);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://storage.example/signed?token=short");
    expect(signedDocumentUrl).toHaveBeenCalledWith(expect.anything(), "org/documents/x.pdf", "Bail.pdf", false);
  });

  it("finds nothing the policies do not let this account read, nor an id that is not one", async () => {
    readable = null;
    expect((await open(DOC)).status).toBe(404);
    expect((await open("../x")).status).toBe(404);
    expect(signedDocumentUrl).not.toHaveBeenCalled();
  });

  it("asks for a session", async () => {
    vi.mocked(getSession).mockResolvedValue(null as never);
    expect((await open(DOC)).status).toBe(401);
  });
});

describe("the tenant's pages", () => {
  const HOME = { lease_id: "l-1", org_id: "o-1", unit_id: "u-1", property_id: "p-1", lease_status: "active", lease_type: "residential", start_date: "2023-04-01", end_date: null, rent_cents: 100000, charges_cents: 0, charges_regime: "advances", payment_day: 1, rf_reference: "RF1", unit_label: "Apt", property_name: "Rés." };
  const docs = [
    { id: "d-ok", lease_id: "l-1", name: "Bail.pdf", class: "lease", storage_path: "o-1/documents/ok.pdf", related_type: "lease", related_id: "l-1", created_at: "2026-11-01T00:00:00Z" },
    { id: "d-no", lease_id: "l-1", name: "Autre.pdf", class: "other", storage_path: "o-1/documents/no.pdf", related_type: "lease", related_id: "l-1", created_at: "2026-11-01T00:00:00Z" },
  ];
  const reader = () => {
    const chain = (rows: unknown[]) => {
      const q = { in: () => q, eq: () => q, order: () => q, limit: async () => ({ data: rows, error: null }) };
      return q;
    };
    return {
      rpc: async (name: string) => (name === "my_home" ? { data: [HOME], error: null } : name === "my_visits" ? { data: null, error: { code: "PGRST202" } } : { data: [], error: null }),
      from: (table: string) => ({ select: () => chain(table === "documents" ? docs : []) }),
    } as unknown as GestionReader;
  };

  it("link a readable piece to the route, and a piece whose file cannot be read to nothing", async () => {
    const space = await buildTenantSpace(reader(), {
      userId: "u-t", email: "t@example.test", displayName: "T", today: "2026-11-20",
      sign: async (paths) => new Map(paths.filter((p) => p.endsWith("ok.pdf")).map((p) => [p, "https://storage.example/one-hour"])),
    });
    const all = [...(space.current?.documents ?? []), ...space.others.flatMap((l) => l.documents)];
    const byId = new Map(all.map((d) => [d.id, d.url]));
    expect(byId.get("d-ok")).toBe(tenantDocumentHref("d-ok"));
    expect(byId.get("d-no")).toBeNull();
    expect(JSON.stringify(space)).not.toContain("one-hour");
  });
});
