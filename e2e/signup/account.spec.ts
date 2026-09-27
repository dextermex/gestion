import { expect, test, type APIRequestContext } from "@playwright/test";
import { createClient, type Session } from "@supabase/supabase-js";

// NextURL normalizes loopback addresses to localhost. Use the browser's same
// canonical origin so the real CSRF check remains enabled throughout this test.
const APP = "http://localhost:4321";
const MAIL = "http://127.0.0.1:54324";
const API = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const preferences = { properties: "2-5", challenge: "rent", involvement: "5" };

test.beforeAll(() => {
  // Never run fixture identities or known OTPs against a hosted project.
  expect(API).toBe("http://127.0.0.1:54321");
  expect(KEY.length).toBeGreaterThan(20);
});

function client() {
  return createClient(API, KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
}

function sessionHeaders(session: Session) {
  // Same cookie format read by getSession; tokens still get verified by Auth.
  const value = "b64." + Buffer.from(JSON.stringify({ access_token: session.access_token })).toString("base64url");
  return { origin: APP, cookie: "morada_auth=" + value };
}

async function save(request: APIRequestContext, session: Session, data: Record<string, unknown>) {
  return request.post("/api/signup/profile", { headers: sessionHeaders(session), data });
}

async function phoneAccount(phone: string) {
  const db = client();
  const sent = await db.auth.signInWithOtp({ phone, options: { data: { preferred_language: "en", morada_signup: { version: 1, stage: "role" } } } });
  expect(sent.error).toBeNull();
  const wrong = await db.auth.verifyOtp({ phone, type: "sms", token: "000000" });
  expect(wrong.error).not.toBeNull();
  expect(wrong.data.session).toBeNull();
  const verified = await db.auth.verifyOtp({ phone, type: "sms", token: "123456" });
  expect(verified.error).toBeNull();
  expect(verified.data.user?.phone_confirmed_at).toBeTruthy();
  expect(verified.data.session).not.toBeNull();
  return { db, session: verified.data.session! };
}

async function confirmEmail(request: APIRequestContext, email: string) {
  let messageId = "";
  await expect.poll(async () => {
    const response = await request.get(MAIL + "/api/v1/search", { params: { query: "to:" + email } });
    expect(response.ok()).toBe(true);
    const body = await response.json();
    messageId = body.messages?.[0]?.ID ?? "";
    return messageId;
  }).not.toBe("");
  const message = await (await request.get(MAIL + "/api/v1/message/" + messageId)).json();
  const links = String(message.HTML).match(/https?:[^"<>\s]+/g) ?? [];
  const link = links.map((value) => new URL(value.replaceAll("&amp;", "&"))).find((url) => url.pathname === "/auth/v1/verify");
  expect(link).toBeDefined();
  // This is real email verification, confined to the throwaway Auth server.
  expect(link!.origin).toBe(API);
  expect(link!.searchParams.get("redirect_to")).toBe("https://app.morada.lu/inscription");
  const confirmed = await request.get(link!.toString(), { maxRedirects: 0 });
  expect([302, 303]).toContain(confirmed.status());
  const destination = new URL(confirmed.headers().location);
  expect(destination.origin + destination.pathname).toBe("https://app.morada.lu/inscription");
  expect(destination.hash).not.toContain("error");
}

test("phone signup persists one identity, confirms its email and provisions a private landlord workspace", async ({ request }) => {
  const anonymous = await request.post("/api/signup/profile", { headers: { origin: APP }, data: { action: "complete", preferences } });
  expect(anonymous.status()).toBe(401);
  const { db, session } = await phoneAccount("+12025550101");
  const id = session.user.id;
  const initial = await db.from("profiles").select("id").eq("id", id).single();
  expect(initial.error).toBeNull();
  expect(initial.data?.id).toBe(id);
  const details = { action: "details", firstName: "Signup", lastName: "Landlord", role: "landlord", locale: "en" };
  const foreignOrigin = await request.post("/api/signup/profile", { headers: { ...sessionHeaders(session), origin: "https://foreign.test" }, data: details });
  expect(foreignOrigin.status()).toBe(403);
  expect((await save(request, session, { action: "complete", preferences })).status()).toBe(400);
  expect((await save(request, session, details)).status()).toBe(200);
  const profile = await db.from("profiles").select("first_name,last_name,phone,preferred_language").eq("id", id).single();
  expect(profile.error).toBeNull();
  expect(profile.data).toEqual({ first_name: "Signup", last_name: "Landlord", phone: "12025550101", preferred_language: "en" });
  const email = `landlord.${Date.now()}@signup.morada.test`;
  const registered = await save(request, session, { action: "email", email });
  expect(registered.status()).toBe(200);
  expect(await registered.json()).toEqual({ ok: true, emailPending: true });
  await confirmEmail(request, email);
  const user = await db.auth.getUser();
  expect(user.data.user?.id).toBe(id);
  expect(user.data.user?.email).toBe(email);
  expect(user.data.user?.email_confirmed_at).toBeTruthy();
  expect((await save(request, session, { action: "complete", preferences })).status()).toBe(200);
  const completed = (await db.auth.getUser()).data.user;
  expect(completed?.user_metadata.morada_signup).toMatchObject({ role: "landlord", stage: "complete", preferences });
  const dashboard = await request.get("/app", { headers: sessionHeaders(session) });
  expect(dashboard.status()).toBe(200);
  expect(new URL(dashboard.url()).pathname).toBe("/app");
  const memberships = await db.from("crm_members").select("agency_id,role").eq("user_id", id);
  expect(memberships.error).toBeNull();
  expect(memberships.data).toHaveLength(1);
  expect(memberships.data![0].role).toBe("owner");
  const workspace = await db.from("agencies").select("name,kind,is_public").eq("id", memberships.data![0].agency_id).single();
  expect(workspace.error).toBeNull();
  expect(workspace.data).toEqual({ name: "Signup Landlord", kind: "owner", is_public: false });
});

test("tenant signup saves its own profile and opens without creating a landlord workspace", async ({ request }) => {
  const { db, session } = await phoneAccount("+12025550102");
  expect((await save(request, session, { action: "details", firstName: "Signup", lastName: "Tenant", role: "tenant", locale: "fr" })).status()).toBe(200);
  const email = `tenant.${Date.now()}@signup.morada.test`;
  expect((await save(request, session, { action: "email", email })).status()).toBe(200);
  await confirmEmail(request, email);
  expect((await save(request, session, { action: "complete", preferences })).status()).toBe(200);
  expect((await db.auth.getUser()).data.user?.user_metadata.morada_signup).toMatchObject({ role: "tenant", stage: "complete", preferences: null });
  const tenant = await request.get("/locataire", { headers: sessionHeaders(session) });
  expect(tenant.status()).toBe(200);
  expect(new URL(tenant.url()).pathname).toBe("/locataire");
  const memberships = await db.from("crm_members").select("agency_id").eq("user_id", session.user.id);
  expect(memberships.error).toBeNull();
  expect(memberships.data).toEqual([]);
  const otherProfiles = await db.from("profiles").select("id").neq("id", session.user.id);
  expect(otherProfiles.error).toBeNull();
  expect(otherProfiles.data).toEqual([]);
});
