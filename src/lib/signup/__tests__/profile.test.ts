import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/signup/profile/route";
import { authedClient, getSession } from "@/lib/supabase/server";
import { updateSignupUser } from "../update-user";
import { EMPTY_PREFERENCES } from "../model";

vi.mock("@/lib/supabase/server", () => ({ getSession: vi.fn(), authedClient: vi.fn() }));
vi.mock("../update-user", () => ({ updateSignupUser: vi.fn() }));

const user = () => ({
  id: "verified-user", phone: "352621123456", phone_confirmed_at: "2026-09-27",
  email: "", new_email: "", email_confirmed_at: "",
  user_metadata: { morada_signup: { role: "landlord", stage: "email" } },
});
let current: ReturnType<typeof user>;
let db: ReturnType<typeof database>;
function database() {
  const query = {
    update: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: { id: "verified-user", first_name: "Alex", last_name: "Example" }, error: null }),
  };
  // The confirmation e-mails are counted in the database, under the caller's token.
  const rpc = vi.fn(async (): Promise<{ data: unknown; error: null }> => ({ data: true, error: null }));
  return { from: vi.fn(() => query), query, rpc, schema: vi.fn(() => ({ rpc })), auth: { getUser: vi.fn(async () => ({ data: { user: current }, error: null })) } };
}
const details = { action: "details", firstName: "Alex", lastName: "Example", locale: "en", role: "landlord" };
function request(body: unknown, origin = "https://app.morada.lu") {
  return new NextRequest("https://app.morada.lu/api/signup/profile", {
    method: "POST", headers: { origin, "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  current = user(); db = database();
  vi.mocked(getSession).mockResolvedValue({ userId: current.id, email: "", accessToken: "user-token" });
  vi.mocked(authedClient).mockReturnValue(db as unknown as ReturnType<typeof authedClient>);
  vi.mocked(updateSignupUser).mockResolvedValue({ error: null });
});

describe("authenticated profile completion", () => {
  it("rejects cross-origin writes before touching authentication", async () => {
    expect((await POST(request(details, "https://evil.test"))).status).toBe(403);
    expect(getSession).not.toHaveBeenCalled();
  });
  it("rejects signed-out and unverified-phone accounts", async () => {
    vi.mocked(getSession).mockResolvedValueOnce(null);
    expect((await POST(request(details))).status).toBe(401);
    current.phone_confirmed_at = "";
    expect((await POST(request(details))).status).toBe(403);
    expect(db.from).not.toHaveBeenCalled();
  });
  it("writes only the verified identity, ignoring submitted account IDs", async () => {
    expect((await POST(request({ ...details, id: "another-user" }))).status).toBe(200);
    expect(db.query.eq).toHaveBeenCalledWith("id", "verified-user");
    expect(db.query.update).toHaveBeenCalledWith({ first_name: "Alex", last_name: "Example", phone: current.phone, preferred_language: "en" });
    expect(updateSignupUser).toHaveBeenCalledWith("user-token", expect.objectContaining({ data: expect.objectContaining({ morada_signup: expect.objectContaining({ stage: "email" }) }) }));
  });
  it("does not advance if profile persistence fails", async () => {
    db.query.single.mockResolvedValueOnce({ data: null, error: { message: "RLS denied" } });
    expect((await POST(request(details))).status).toBe(502);
    expect(updateSignupUser).not.toHaveBeenCalled();
  });
  it("adds an email to the same account and reports pending confirmation", async () => {
    const response = await POST(request({ action: "email", email: "Alex@example.test" }));
    expect(await response.json()).toEqual({ ok: true, emailPending: true });
    expect(updateSignupUser).toHaveBeenCalledWith("user-token", { email: "alex@example.test" });
  });
  it("does not resend a confirmation for an unchanged pending address", async () => {
    current.new_email = "alex@example.test";
    expect((await POST(request({ action: "email", email: current.new_email }))).status).toBe(200);
    expect(updateSignupUser).toHaveBeenCalledTimes(1);
    expect(updateSignupUser).not.toHaveBeenCalledWith("user-token", { email: current.new_email });
  });
  it("cannot finish before an address is given and a password set, and never converts tenant preferences into access", async () => {
    const body = { action: "complete", preferences: EMPTY_PREFERENCES };
    expect((await POST(request(body))).status).toBe(409);
    // A pending address is enough: the funnel does not wait for the confirmation mail.
    current.new_email = "tenant@example.test";
    expect(await (await POST(request(body))).json()).toEqual({ error: "password_required" });
    Object.assign(current.user_metadata.morada_signup, { role: "tenant", password_set_at: "2026-09-27" });
    expect((await POST(request(body))).status).toBe(200);
    expect(updateSignupUser).toHaveBeenCalledWith("user-token", { data: { morada_signup: expect.objectContaining({ role: "tenant", stage: "complete", preferences: null }) } });
    expect(db.query.update).not.toHaveBeenCalled();
  });
  it("records the address and moves on to the password, confirmed or not, never moving a later stage back", async () => {
    await POST(request({ action: "email", email: "alex@example.test" }));
    expect(updateSignupUser).toHaveBeenLastCalledWith("user-token", { data: { morada_signup: expect.objectContaining({ stage: "password" }) } });
    vi.mocked(updateSignupUser).mockClear();
    Object.assign(current, { email: "alex@example.test", email_confirmed_at: "2026-09-27" });
    const response = await POST(request({ action: "email", email: "alex@example.test" }));
    expect(await response.json()).toEqual({ ok: true, emailPending: false });
    expect(updateSignupUser).toHaveBeenCalledTimes(1);
    expect(updateSignupUser).toHaveBeenCalledWith("user-token", { data: { morada_signup: expect.objectContaining({ stage: "password" }) } });
    vi.mocked(updateSignupUser).mockClear();
    current.user_metadata.morada_signup.stage = "complete";
    await POST(request({ action: "email", email: "alex@example.test" }));
    expect(updateSignupUser).toHaveBeenCalledWith("user-token", { data: { morada_signup: expect.objectContaining({ stage: "complete" }) } });
  });
  it("advances past the email only when Auth reports it confirmed", async () => {
    current.new_email = "alex@example.test";
    expect(await (await POST(request({ action: "email_confirmed" }))).json()).toEqual({ error: "email_unconfirmed" });
    expect(updateSignupUser).not.toHaveBeenCalled();
    Object.assign(current, { email: "alex@example.test", new_email: "", email_confirmed_at: "2026-09-27" });
    expect((await POST(request({ action: "email_confirmed" }))).status).toBe(200);
    expect(updateSignupUser).toHaveBeenCalledWith("user-token", { data: { morada_signup: expect.objectContaining({ stage: "password" }) } });
  });
  it("sets the password only past the e-mail step, then tailoring for a landlord and done for a tenant", async () => {
    expect((await POST(request({ action: "password", password: "long-enough-1" }))).status).toBe(409);
    expect((await POST(request({ action: "password", password: "short" }))).status).toBe(400);
    Object.assign(current, { email: "alex@example.test", email_confirmed_at: "2026-09-27" });
    const landlord = await POST(request({ action: "password", password: "long-enough-1" }));
    expect(await landlord.json()).toEqual({ ok: true, stage: "tailor" });
    expect(updateSignupUser).toHaveBeenCalledWith("user-token", { password: "long-enough-1", data: { morada_signup: expect.objectContaining({ stage: "tailor", password_set_at: expect.any(String) }) } });
    current.user_metadata.morada_signup.role = "tenant";
    expect(await (await POST(request({ action: "password", password: "long-enough-1" }))).json()).toEqual({ ok: true, stage: "complete" });
    vi.mocked(updateSignupUser).mockResolvedValueOnce({ error: { code: "weak_password" } });
    expect(await (await POST(request({ action: "password", password: "password1" }))).json()).toEqual({ error: "weak_password" });
  });
  it("keeps an account finished before passwords existed finished once it sets one", async () => {
    Object.assign(current, { email: "alex@example.test", email_confirmed_at: "2026-09-27" });
    current.user_metadata.morada_signup.stage = "complete";
    expect(await (await POST(request({ action: "password", password: "long-enough-1" }))).json()).toEqual({ ok: true, stage: "complete" });
  });
  it("answers an address another account holds like any other, and goes on to the password the same way", async () => {
    vi.mocked(updateSignupUser).mockResolvedValueOnce({ error: { code: "email_exists" } });
    const response = await POST(request({ action: "email", email: "existing@example.test" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, emailPending: true });
    expect(updateSignupUser).toHaveBeenLastCalledWith("user-token", { data: { morada_signup: expect.objectContaining({ stage: "password" }) } });
    // Auth holds no pending address for it, and the password is accepted all the same (the same screens for every address).
    current.user_metadata.morada_signup.stage = "password";
    expect(await (await POST(request({ action: "password", password: "long-enough-1" }))).json()).toEqual({ ok: true, stage: "tailor" });
    vi.mocked(updateSignupUser).mockClear();
    vi.mocked(updateSignupUser).mockResolvedValueOnce({ error: { code: "over_email_send_rate_limit" } });
    current.user_metadata.morada_signup.stage = "email";
    expect(await (await POST(request({ action: "email", email: "other@example.test" }))).json()).toEqual({ error: "rate_limited" });
  });
  it("sets the first password only: a password already set is changed through the reset link", async () => {
    Object.assign(current, { email: "alex@example.test", email_confirmed_at: "2026-09-27" });
    Object.assign(current.user_metadata.morada_signup, { password_set_at: "2026-09-27T10:00:00Z" });
    const refused = await POST(request({ action: "password", password: "long-enough-2" }));
    expect(refused.status).toBe(409);
    expect(await refused.json()).toEqual({ error: "password_set" });
    expect(updateSignupUser).not.toHaveBeenCalled();
  });
  it("counts the confirmation e-mails it asks for, and stops over the limit before asking for another", async () => {
    expect((await POST(request({ action: "email", email: "alex@example.com" }))).status).toBe(200);
    expect(db.rpc).toHaveBeenCalledWith("rate_take", expect.objectContaining({ p_action: "mail.account", p_org: null, p_user_max: 6 }));
    vi.mocked(updateSignupUser).mockClear();
    db.rpc.mockResolvedValueOnce({ data: false, error: null });
    const refused = await POST(request({ action: "email", email: "another@example.com" }));
    expect(refused.status).toBe(429);
    expect(await refused.json()).toMatchObject({ error: "rate_limited" });
    expect(updateSignupUser).not.toHaveBeenCalled();
  });
});

describe("the questions and the offer, saved in the iPhone app's keys", () => {
  const quiz = { kind: "flats", manageFor: "self", units: "2-5", where: "lu", today: "spreadsheet", late: "days", goal: "rent", source: "word" };
  const preferences = { properties: "2-5", challenge: "rent", involvement: "5" };
  const dashboard = { order: ["arrears", "actions", "cashflow", "costs", "requests", "activity"], hidden: ["costs", "requests"], interests: ["arrears", "actions", "cashflow"], horizon: "month", watch: ["arrears"] };
  const ready = () => {
    Object.assign(current, { new_email: "alex@example.test" });
    Object.assign(current.user_metadata.morada_signup, { stage: "tailor", password_set_at: "2026-11-27T10:00:00Z" });
  };
  it("finishes the account with the web's preferences, the app's quiz and its home screen", async () => {
    ready();
    (current.user_metadata as Record<string, unknown>).morada_mobile = { tour: 1 };
    expect((await POST(request({ action: "complete", preferences, quiz, dashboard }))).status).toBe(200);
    expect(updateSignupUser).toHaveBeenCalledWith("user-token", { data: {
      morada_signup: expect.objectContaining({ stage: "complete", completed_at: expect.any(String), preferences }),
      morada_mobile: { tour: 1, quiz: { ...quiz, offer: null }, dashboard },
    } });
  });
  it("refuses a key or a value that is not the app's, and saves nothing", async () => {
    ready();
    expect((await POST(request({ action: "complete", preferences, quiz: { ...quiz, kind: "castle" } }))).status).toBe(400);
    expect((await POST(request({ action: "complete", preferences, quiz: { ...quiz, comment: "hello" } }))).status).toBe(400);
    expect((await POST(request({ action: "complete", preferences, dashboard: { ...dashboard, order: ["everything"] } }))).status).toBe(400);
    expect(updateSignupUser).not.toHaveBeenCalled();
  });
  it("keeps a tenant's account free of landlord answers", async () => {
    ready();
    current.user_metadata.morada_signup.role = "tenant";
    expect((await POST(request({ action: "complete", preferences, quiz, dashboard }))).status).toBe(200);
    expect(updateSignupUser).toHaveBeenCalledWith("user-token", { data: { morada_signup: expect.objectContaining({ preferences: null }) } });
  });
  it("lets an Apple or Google account finish without a phone or a password of its own", async () => {
    Object.assign(current, { phone_confirmed_at: "", phone: "", email: "alex@privaterelay.appleid.com", email_confirmed_at: "2026-11-27" });
    (current as Record<string, unknown>).app_metadata = { provider: "apple", providers: ["apple"] };
    current.user_metadata.morada_signup.stage = "password";
    expect((await POST(request({ action: "complete", preferences, quiz }))).status).toBe(200);
    (current as Record<string, unknown>).app_metadata = { provider: "phone", providers: ["phone"] };
    expect((await POST(request({ action: "complete", preferences, quiz }))).status).toBe(403);
  });
  it("records what the offer screen came to once the account is complete, and only for a landlord", async () => {
    ready();
    const outcome = { action: "offer", outcome: "declined", offer: { units: 3, band: 1, billing: "year" } };
    expect(await (await POST(request(outcome))).json()).toEqual({ error: "details_required" });
    current.user_metadata.morada_signup.stage = "complete";
    (current.user_metadata as Record<string, unknown>).morada_mobile = { quiz: { ...quiz, offer: null }, dashboard };
    expect((await POST(request(outcome))).status).toBe(200);
    expect(updateSignupUser).toHaveBeenCalledWith("user-token", { data: { morada_mobile: {
      quiz: { ...quiz, offer: "declined" }, dashboard, offer: { units: 3, band: 1, billing: "year", addon: false },
    } } });
    expect((await POST(request({ ...outcome, outcome: "later" }))).status).toBe(400);
    expect((await POST(request({ ...outcome, offer: { units: 99, band: 1, billing: "year" } }))).status).toBe(400);
    current.user_metadata.morada_signup.role = "tenant";
    expect((await POST(request(outcome))).status).toBe(400);
  });
});
