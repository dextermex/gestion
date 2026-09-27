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
  return { from: vi.fn(() => query), query, auth: { getUser: vi.fn(async () => ({ data: { user: current }, error: null })) } };
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
  it("cannot finish without an email, and never converts tenant preferences into access", async () => {
    const body = { action: "complete", preferences: EMPTY_PREFERENCES };
    expect((await POST(request(body))).status).toBe(400);
    current.new_email = "tenant@example.test"; current.user_metadata.morada_signup.role = "tenant";
    expect((await POST(request(body))).status).toBe(200);
    expect(updateSignupUser).toHaveBeenCalledWith("user-token", { data: { morada_signup: expect.objectContaining({ role: "tenant", stage: "complete", preferences: null }) } });
    expect(db.query.update).not.toHaveBeenCalled();
  });
  it("does not save tailoring stage when email registration fails", async () => {
    vi.mocked(updateSignupUser).mockResolvedValueOnce({ error: { code: "email_exists" } });
    const response = await POST(request({ action: "email", email: "existing@example.test" }));
    expect(await response.json()).toEqual({ error: "email_exists" });
    expect(updateSignupUser).toHaveBeenCalledTimes(1);
  });
});
