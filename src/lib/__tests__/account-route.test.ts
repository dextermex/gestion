import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/compte/route";
import { isSampleData } from "@/lib/demo";
import { mailConfigured, sendMail } from "@/lib/mail";
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
vi.mock("@/lib/mail", () => ({ mailConfigured: vi.fn(() => false), sendMail: vi.fn(), escapeHtml: (s: string) => s }));

const USER = { id: "user-1", email: "guillaume@example.lu", phone: "352621123456" };
let query: { update: ReturnType<typeof vi.fn>; eq: ReturnType<typeof vi.fn>; select: ReturnType<typeof vi.fn>; maybeSingle: ReturnType<typeof vi.fn> };
// The `gestion` schema as the route uses it: the count of its e-mails, and the requests the team lists.
let requests: { inserted: unknown[]; withdrawn: unknown[]; error: { code: string } | null };
let withinLimit: boolean;
const rpc = vi.fn(async () => ({ data: withinLimit, error: null }));
function gestion() {
  const table = {
    insert: vi.fn(async (row: unknown) => {
      if (!requests.error) requests.inserted.push(row);
      return { error: requests.error };
    }),
    update: vi.fn((row: unknown) => {
      const chain = {
        eq: () => chain,
        is: () => chain,
        then: (resolve: (v: unknown) => unknown) => {
          if (!requests.error) requests.withdrawn.push(row);
          return Promise.resolve({ error: requests.error }).then(resolve);
        },
      };
      return chain;
    }),
  };
  return { rpc, from: vi.fn(() => table) };
}
const request = (body: unknown, origin = "https://app.morada.lu") =>
  new NextRequest("https://app.morada.lu/api/compte", { method: "POST", headers: { origin, "Content-Type": "application/json" }, body: JSON.stringify(body) });

beforeEach(() => {
  vi.clearAllMocks();
  query = { update: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), select: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue({ data: { id: USER.id }, error: null }) };
  requests = { inserted: [], withdrawn: [], error: null };
  withinLimit = true;
  vi.mocked(mailConfigured).mockReturnValue(false);
  vi.mocked(sendMail).mockResolvedValue({ sent: true, id: "mail-1" });
  vi.mocked(authedClient).mockReturnValue({ from: vi.fn(() => query), schema: vi.fn(() => gestion()), auth: { getUser: vi.fn(async () => ({ data: { user: USER }, error: null })) } } as never);
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

  it("leaves the deletion request where the team lists it, dated by the database, and withdraws it there too", async () => {
    const asked = await POST(request({ action: "delete" }));
    expect(await asked.json()).toEqual({ ok: true, notified: true });
    // Only the kind and the address are sent: the account and the date are the database's own.
    expect(requests.inserted).toEqual([{ kind: "deletion", email: USER.email }]);
    const back = await POST(request({ action: "restore" }));
    expect(await back.json()).toEqual({ ok: true, notified: true });
    expect(requests.withdrawn).toHaveLength(1);
    expect(sendMail).not.toHaveBeenCalled();
  });

  it("writes to the team when the deployment can send, naming the account and nothing else", async () => {
    vi.mocked(mailConfigured).mockReturnValue(true);
    expect(await (await POST(request({ action: "delete" }))).json()).toEqual({ ok: true, notified: true });
    const mail = vi.mocked(sendMail).mock.calls[0][0];
    expect(mail.to).toBe("bonjour@morada.lu");
    expect(mail.text).toContain(USER.id);
    expect(mail.text).toContain(USER.email);
    expect(mail.text).not.toContain("token");
  });

  it("says when the request reached nobody: no table yet and no way to send", async () => {
    requests.error = { code: "PGRST205" };
    const res = await POST(request({ action: "delete" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, notified: false });
    // The note on the account is written all the same: the screen shows the request and asks the person to write.
    expect(updateSignupUser).toHaveBeenCalledTimes(1);
    // An e-mail alone is enough to reach the team.
    vi.mocked(mailConfigured).mockReturnValue(true);
    expect(await (await POST(request({ action: "delete" }))).json()).toEqual({ ok: true, notified: true });
    // A request already open is what was asked: not a failure.
    vi.mocked(mailConfigured).mockReturnValue(false);
    requests.error = { code: "23505" };
    expect(await (await POST(request({ action: "delete" }))).json()).toEqual({ ok: true, notified: true });
  });

  it("counts the requests and stops over the limit before writing anything", async () => {
    withinLimit = false;
    const res = await POST(request({ action: "delete" }));
    expect(res.status).toBe(429);
    expect(updateSignupUser).not.toHaveBeenCalled();
    expect(requests.inserted).toEqual([]);
    expect(rpc).toHaveBeenCalledWith("rate_take", expect.objectContaining({ p_action: "mail.account", p_org: null }));
  });
});
