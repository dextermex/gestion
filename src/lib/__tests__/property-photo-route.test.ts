import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { authedClient, getSession } from "@/lib/supabase/server";
import { getIdentity } from "@/lib/workspace";
import { refuseWhenLocked } from "@/lib/billing/gate";
import { POST } from "@/app/api/biens/photo/route";

/**
 * A property has one photograph: a new one replaces it and the file it
 * replaces leaves the bucket; a file whose record could not be written does
 * not stay either; a file larger than a request may carry is refused.
 */
vi.mock("@/lib/supabase/server", () => ({ authedClient: vi.fn(), getSession: vi.fn() }));
vi.mock("@/lib/workspace", () => ({ getIdentity: vi.fn() }));
vi.mock("@/lib/billing/gate", () => ({ refuseWhenLocked: vi.fn() }));

const ORG = "0f0f0f0f-0000-4000-8000-00000000c0de";

function client(current: string | null, failSet = false) {
  const uploaded: string[] = [];
  const removed: string[] = [];
  const updates: Array<Record<string, unknown>> = [];
  const query = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    update: vi.fn((patch: Record<string, unknown>) => {
      updates.push(patch);
      return { eq: () => ({ eq: async () => ({ error: failSet ? { code: "42501", message: "denied" } : null }) }) };
    }),
    maybeSingle: vi.fn(async () => ({ data: { id: "p-1", photo_url: current }, error: null })),
  };
  const bucket = {
    upload: vi.fn(async (path: string) => {
      uploaded.push(path);
      return { error: null };
    }),
    remove: vi.fn(async (paths: string[]) => {
      removed.push(...paths);
      return { error: null };
    }),
  };
  return { uploaded, removed, updates, api: { schema: () => ({ from: () => query }), storage: { from: () => bucket } } };
}

function post(size = 1000) {
  const form = new FormData();
  form.set("file", new File([new Uint8Array(size)], "facade.jpg", { type: "image/jpeg" }));
  form.set("propertyId", "p-1");
  return POST(new NextRequest("https://app.morada.lu/api/biens/photo", { method: "POST", body: form, headers: { origin: "https://app.morada.lu" } }));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSession).mockResolvedValue({ userId: "u-1", email: "owner@example.lu", accessToken: "tok" } as never);
  vi.mocked(getIdentity).mockResolvedValue({ active: { id: ORG, name: "Cabinet Test", kind: "owner", role: "owner" } } as never);
  vi.mocked(refuseWhenLocked).mockResolvedValue(null);
});

describe("a property's photograph", () => {
  it("replaces the one before it, whose file leaves the bucket", async () => {
    const c = client(`${ORG}/p-1/old.jpg`);
    vi.mocked(authedClient).mockReturnValue(c.api as never);
    const res = await post();
    expect(res.status).toBe(200);
    expect(c.updates).toEqual([{ photo_url: c.uploaded[0] }]);
    expect(c.removed).toEqual([`${ORG}/p-1/old.jpg`]);
  });

  it("leaves an outside address alone, and removes nothing for a first photograph", async () => {
    for (const current of [null, "https://images.example.com/facade.jpg"]) {
      const c = client(current);
      vi.mocked(authedClient).mockReturnValue(c.api as never);
      expect((await post()).status).toBe(200);
      expect(c.removed).toEqual([]);
    }
  });

  it("takes back the new file when its record is refused, and keeps the old one", async () => {
    const c = client(`${ORG}/p-1/old.jpg`, true);
    vi.mocked(authedClient).mockReturnValue(c.api as never);
    expect((await post()).status).toBe(502);
    expect(c.removed).toEqual(c.uploaded);
  });

  it("refuses a file larger than a request may carry, before storing anything", async () => {
    const c = client(null);
    vi.mocked(authedClient).mockReturnValue(c.api as never);
    expect((await post(4 * 1024 * 1024 + 1)).status).toBe(413);
    expect(c.uploaded).toEqual([]);
  });
});
