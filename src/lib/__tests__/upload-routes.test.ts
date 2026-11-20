import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { withOrgAndClient } from "@/lib/gestion/api";
import { withTenant } from "@/lib/portal/session";
import { authedClient } from "@/lib/supabase/server";
import { attachTenantFiles } from "@/lib/portal/requests";
import { FakeDb } from "./helpers/fake-postgrest";
import { ORG } from "./helpers/tenancy";

/**
 * Two upload routes and what they leave behind. An inventory's photographs
 * form one chain whatever order two simultaneous uploads are written in; a
 * tenant's file whose row is refused does not stay in the lease's folder.
 */
vi.mock("@/lib/gestion/api", async (actual) => ({ ...(await actual<typeof import("@/lib/gestion/api")>()), withOrgAndClient: vi.fn() }));
vi.mock("@/lib/portal/session", () => ({ withTenant: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ authedClient: vi.fn() }));
vi.mock("@/lib/portal/requests", () => ({ attachTenantFiles: vi.fn() }));

const today = new Date().toISOString().slice(0, 10);

function bucket() {
  const uploaded: string[] = [];
  const removed: string[] = [];
  const api = {
    upload: vi.fn(async (path: string) => {
      uploaded.push(path);
      return { data: { path }, error: null };
    }),
    remove: vi.fn(async (paths: string[]) => {
      removed.push(...paths);
      return { data: [], error: null };
    }),
  };
  return { api, uploaded, removed, client: { storage: { from: () => api } } };
}

function photo(name: string, bytes: number[]) {
  const form = new FormData();
  form.set("file", new File([new Uint8Array(bytes)], name, { type: "image/jpeg" }));
  form.set("itemId", "item-1");
  return form;
}

describe("an inventory's photographs", () => {
  let db: FakeDb;
  beforeEach(() => {
    vi.clearAllMocks();
    db = new FakeDb(today);
    db.insertRow("edl_sessions", { id: "edl-1", org_id: ORG, lease_id: "l-1", kind: "entry", status: "draft", hash_manifest_sha256: null });
    db.insertRow("edl_items", { id: "item-1", org_id: ORG, session_id: "edl-1", room: "Séjour", element: "Mur" });
    db.insertRow("edl_media", { id: "m-p", org_id: ORG, item_id: "item-1", storage_path: `${ORG}/edl/edl-1/p.jpg`, sha256: "sha-p", captured_at: "2000-01-01T09:00:00.000Z", prev_sha256: null });
  });

  it("stay one chain when a photo sent at the same moment was written first with the same predecessor", async () => {
    const store = bucket();
    vi.mocked(withOrgAndClient).mockResolvedValue({ g: db.client(), org: { id: ORG, name: "Cabinet Test", kind: "owner", role: "owner" }, userId: "user-owner", client: store.client } as never);
    // Written by a request that read the same predecessor, with a later capture time.
    db.insertRow("edl_media", { id: "m-x", org_id: ORG, item_id: "item-1", storage_path: `${ORG}/edl/edl-1/x.jpg`, sha256: "sha-x", captured_at: "2999-01-01T00:00:00.000Z", prev_sha256: "sha-p" });
    const { POST } = await import("@/app/api/edl/[id]/photos/route");
    const res = await POST(new NextRequest("https://app.morada.lu/api/edl/edl-1/photos", { method: "POST", body: photo("mur.jpg", [1, 2, 3]) }), { params: Promise.resolve({ id: "edl-1" }) });
    expect(res.status).toBe(201);
    const { sha256 } = (await res.json()) as { sha256: string };
    const media = [...db.table("edl_media")].sort((a, b) => String(a.captured_at).localeCompare(String(b.captured_at)));
    expect(media.map((m) => [m.sha256, m.prev_sha256])).toEqual([
      ["sha-p", null],
      [sha256, "sha-p"],
      ["sha-x", sha256],
    ]);
  });

  it("stops, and keeps no file, when the chain cannot be read", async () => {
    const store = bucket();
    vi.mocked(withOrgAndClient).mockResolvedValue({ g: db.client(), org: { id: ORG, name: "Cabinet Test", kind: "owner", role: "owner" }, userId: "user-owner", client: store.client } as never);
    db.absent.add("edl_media");
    const { POST } = await import("@/app/api/edl/[id]/photos/route");
    const res = await POST(new NextRequest("https://app.morada.lu/api/edl/edl-1/photos", { method: "POST", body: photo("mur.jpg", [4, 5]) }), { params: Promise.resolve({ id: "edl-1" }) });
    expect(res.status).toBeGreaterThanOrEqual(500);
    expect(store.removed).toEqual(store.uploaded);
    expect(store.uploaded).toHaveLength(1);
  });
});

describe("a tenant's file whose row is refused", () => {
  it("is taken back out of the lease's folder", async () => {
    const store = bucket();
    const ticket = { id: "t-1", org_id: ORG, lease_id: "l-1", status: "new" };
    const query = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: [], error: null }),
      maybeSingle: vi.fn().mockResolvedValue({ data: ticket, error: null }),
    };
    vi.mocked(withTenant).mockResolvedValue({ g: { from: () => query } as never, session: { userId: "tenant-1", email: "anna@example.lu", accessToken: "tok" } });
    vi.mocked(authedClient).mockReturnValue(store.client as never);
    vi.mocked(attachTenantFiles).mockResolvedValue({ error: "forbidden" } as never);
    const { POST } = await import("@/app/api/locataire/demandes/[id]/pieces/route");
    const form = new FormData();
    form.append("files", new File([new Uint8Array([1, 2, 3])], "evier.png", { type: "image/png" }));
    const res = await POST(new NextRequest("https://app.morada.lu/api/locataire/demandes/t-1/pieces", { method: "POST", body: form }), { params: Promise.resolve({ id: "t-1" }) });
    expect(res.status).toBe(403);
    expect(store.uploaded).toHaveLength(1);
    expect(store.uploaded[0]).toMatch(new RegExp(`^${ORG}/tickets/l-1/`));
    expect(store.removed).toEqual(store.uploaded);
  });

  it("is refused on a closed request, before anything is stored", async () => {
    const store = bucket();
    const query = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: [], error: null }),
      maybeSingle: vi.fn().mockResolvedValue({ data: { id: "t-1", org_id: ORG, lease_id: "l-1", status: "closed" }, error: null }),
    };
    vi.mocked(withTenant).mockResolvedValue({ g: { from: () => query } as never, session: { userId: "tenant-1", email: "anna@example.lu", accessToken: "tok" } });
    vi.mocked(authedClient).mockReturnValue(store.client as never);
    const { POST } = await import("@/app/api/locataire/demandes/[id]/pieces/route");
    const form = new FormData();
    form.append("files", new File([new Uint8Array([1])], "evier.png", { type: "image/png" }));
    const res = await POST(new NextRequest("https://app.morada.lu/api/locataire/demandes/t-1/pieces", { method: "POST", body: form }), { params: Promise.resolve({ id: "t-1" }) });
    expect([res.status, ((await res.json()) as { error: string }).error]).toEqual([409, "request_closed"]);
    expect(store.uploaded).toEqual([]);
  });
});

describe("a bill whose piece was put in the bucket by the browser", () => {
  it("registers the stored file on the bill, with its own size, and refuses a path from elsewhere", async () => {
    const db = new FakeDb(today);
    db.insertRow("agencies", { id: ORG, name: "Cabinet Test" });
    const path = `${ORG}/documents/11111111-2222-4333-8444-555555555555.pdf`;
    const objects = new Map<string, Uint8Array>([[path, new Uint8Array(6_000_000).fill(1)]]);
    const bucketApi = {
      download: async (p: string) => (objects.has(p) ? { data: new Blob([objects.get(p)! as BlobPart]), error: null } : { data: null, error: { message: "not found" } }),
      remove: async () => ({ data: [], error: null }),
    };
    vi.mocked(withOrgAndClient).mockResolvedValue({ g: db.client(), org: { id: ORG, name: "Cabinet Test", kind: "owner", role: "owner" }, userId: "user-owner", client: { storage: { from: () => bucketApi } } } as never);
    const { POST } = await import("@/app/api/finance/factures/route");
    const bill = (uploadedPath: string) => {
      const form = new FormData();
      for (const [k, v] of Object.entries({ direction: "expense", subject: "Ravalement", category: "maintenance_repairs", vatRate: "17", amount: "1200", docDate: today, dueOn: "", uploadedPath, fileName: "devis-ravalement.pdf" })) form.set(k, v);
      return POST(new NextRequest("https://app.morada.lu/api/finance/factures", { method: "POST", body: form }));
    };
    const res = await bill(path);
    expect(res.status).toBe(201);
    const { id, documentId } = (await res.json()) as { id: string; documentId: string };
    const piece = db.table("documents").find((d) => d.id === documentId)!;
    expect([piece.related_type, piece.related_id, piece.size_bytes, piece.class, piece.name]).toEqual(["bill", id, 6_000_000, "invoice", "devis-ravalement.pdf"]);
    expect(db.table("bills").find((b) => b.id === id)!.document_id).toBe(documentId);
    expect((await bill(`${ORG}/tickets/l-1/11111111-2222-4333-8444-555555555555.pdf`)).status).toBe(400);
  });
});
