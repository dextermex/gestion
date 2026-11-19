import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/compte/route";
import { isSampleData } from "@/lib/demo";
import { updateSignupUser } from "@/lib/signup/update-user";
import { authedClient, getSession } from "@/lib/supabase/server";

/**
 * A person's own account route: same origin only, the session's own
 * identity only, and a deletion that is a dated request on the account,
 * never an erasure from here.
 */
vi.mock("@/lib/supabase/server", () => ({ authedClient: vi.fn(), getSession: vi.fn() }));
vi.mock("@/lib/demo", () => ({ isSampleData: vi.fn() }));
vi.mock("@/lib/signup/update-user", () => ({ updateSignupUser: vi.fn() }));

const USER = { id: "user-1", email: "guillaume@example.lu", phone: "352621123456" };
let query: { update: ReturnType<typeof vi.fn>; eq: ReturnType<typeof vi.fn>; select: ReturnType<typeof vi.fn>; maybeSingle: ReturnType<typeof vi.fn> };
const request = (body: unknown, origin = "https://app.morada.lu") =>
  new NextRequest("https://app.morada.lu/api/compte", { method: "POST", headers: { origin, "Content-Type": "application/json" }, body: JSON.stringify(body) });

beforeEach(() => {
  vi.clearAllMocks();
  query = { update: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), select: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue({ data: { id: USER.id }, error: null }) };
  vi.mocked(authedClient).mockReturnValue({ from: vi.fn(() => query), auth: { getUser: vi.fn(async () => ({ data: { user: USER }, error: null })) } } as never);
  vi.mocked(getSession).mockResolvedValue({ userId: USER.id, email: USER.email, accessToken: "token", metadata: { morada_account: { kept: 1 } } });
  vi.mocked(isSampleData).mockResolvedValue(false);
  vi.mocked(updateSignupUser).mockResolvedValue({ error: null });
});

describe("the account route", () => {
  it("refuses another origin, a malformed body and a signed-out caller", async () => {
    expect((await POST(request({ action: "delete" }, "https://evil.test"))).status).toBe(403);
    expect(getSession).not.toHaveBeenCalled();
    expect((await POST(request({ action: "password", password: "x" }))).status).toBe(400);
    vi.mocked(getSession).mockResolvedValueOnce(null);
    expect((await POST(request({ action: "delete" }))).status).toBe(401);
    expect(updateSignupUser).not.toHaveBeenCalled();
  });

  it("saves the name on the caller's own row and on the account", async () => {
    expect((await POST(request({ action: "details", firstName: "Guillaume", lastName: "Metzler" }))).status).toBe(200);
    expect(query.update).toHaveBeenCalledWith({ first_name: "Guillaume", last_name: "Metzler" });
    expect(query.eq).toHaveBeenCalledWith("id", USER.id);
    expect(updateSignupUser).toHaveBeenCalledWith("token", { data: { first_name: "Guillaume", last_name: "Metzler" } });
  });

  it("copies the confirmed mobile to the profile row", async () => {
    expect((await POST(request({ action: "sync" }))).status).toBe(200);
    expect(query.update).toHaveBeenCalledWith({ phone: "+352621123456" });
  });

  it("records a dated deletion request and withdraws it, erasing nothing", async () => {
    expect((await POST(request({ action: "delete" }))).status).toBe(200);
    const asked = vi.mocked(updateSignupUser).mock.calls[0][1].data as { morada_account: { kept: number; deletion_requested_at: string } };
    expect(asked.morada_account.kept).toBe(1);
    expect(Number.isNaN(Date.parse(asked.morada_account.deletion_requested_at))).toBe(false);
    expect(query.update).not.toHaveBeenCalled();
    expect((await POST(request({ action: "restore" }))).status).toBe(200);
    expect(vi.mocked(updateSignupUser).mock.calls[1][1].data).toEqual({ morada_account: { kept: 1, deletion_requested_at: null } });
  });

  it("writes nothing on a sample cabinet", async () => {
    vi.mocked(isSampleData).mockResolvedValue(true);
    expect(await (await POST(request({ action: "delete" }))).json()).toEqual({ ok: true, sample: true });
    expect(updateSignupUser).not.toHaveBeenCalled();
  });

  it("answers 502 when the account system refuses", async () => {
    vi.mocked(updateSignupUser).mockResolvedValue({ error: { code: "x" } });
    expect((await POST(request({ action: "delete" }))).status).toBe(502);
  });
});
