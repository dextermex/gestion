import { NextRequest, NextResponse } from "next/server";
import { authedClient, getSession } from "@/lib/supabase/server";
import { updateSignupUser } from "@/lib/signup/update-user";
import { emailConfirmed, profileInput } from "@/lib/signup/model";

export async function POST(request: NextRequest) {
  if (request.headers.get("origin") !== request.nextUrl.origin) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const input = profileInput.safeParse(await request.json().catch(() => null));
  if (!input.success) return NextResponse.json({ error: "invalid" }, { status: 400 });
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "session_expired" }, { status: 401 });
  const db = authedClient(session.accessToken);
  // Always use a verified server-side identity. Metadata is personalization only.
  const { data: auth, error: authError } = await db.auth.getUser(session.accessToken);
  const user = auth.user;
  if (authError || !user?.phone_confirmed_at) return NextResponse.json({ error: "phone_required" }, { status: 403 });

  try {
    const body = input.data;
    const prior = user.user_metadata?.morada_signup ?? {};
    if (body.action === "details") {
      const { error, data } = await db.from("profiles").update({
        first_name: body.firstName, last_name: body.lastName,
        phone: user.phone, preferred_language: body.locale,
      }).eq("id", user.id).select("id").single();
      if (error || !data) return NextResponse.json({ error: "save_failed" }, { status: 502 });
      const saved = await updateSignupUser(session.accessToken, { data: {
        first_name: body.firstName, last_name: body.lastName, preferred_language: body.locale,
        morada_signup: { ...prior, version: 1, role: body.role, stage: "email" },
      } });
      if (saved.error) return NextResponse.json({ error: "save_failed" }, { status: 502 });
      return NextResponse.json({ ok: true });
    }

    // A direct API call cannot mark an account complete before the details exist.
    const profile = await db.from("profiles").select("first_name,last_name").eq("id", user.id).single();
    if (profile.error || !profile.data?.first_name || !profile.data?.last_name || !["landlord", "tenant"].includes(prior.role)) {
      return NextResponse.json({ error: "details_required" }, { status: 400 });
    }
    if (body.action === "email") {
      const email = body.email.toLowerCase();
      const already = emailConfirmed(user) && user.email === email;
      if (!already && user.new_email !== email) {
        const changed = await updateSignupUser(session.accessToken, { email });
        if (changed.error) {
          const code = changed.error.code;
          return NextResponse.json({ error: code === "email_exists" || code === "user_already_exists" ? "email_exists" : code === "over_email_send_rate_limit" || code === "over_request_rate_limit" ? "rate_limited" : "save_failed" }, { status: 400 });
        }
      }
      // An address confirmed through a linked Google/Apple identity skips the code.
      const saved = await updateSignupUser(session.accessToken, { data: { morada_signup: { ...prior, stage: already ? "password" : "email_code" } } });
      if (saved.error) return NextResponse.json({ error: "save_failed" }, { status: 502 });
      return NextResponse.json({ ok: true, emailPending: !already });
    }

    // Auth, not the client, says whether the code or the link was accepted.
    if (!emailConfirmed(user)) return NextResponse.json({ error: "email_unconfirmed" }, { status: 409 });

    if (body.action === "email_confirmed") {
      if (!["complete", "tailor", "password"].includes(prior.stage)) {
        const saved = await updateSignupUser(session.accessToken, { data: { morada_signup: { ...prior, stage: "password" } } });
        if (saved.error) return NextResponse.json({ error: "save_failed" }, { status: 502 });
      }
      return NextResponse.json({ ok: true });
    }

    if (body.action === "password") {
      // Tenants have no tailoring questions; accounts finished before
      // passwords existed stay finished.
      const finished = prior.stage === "complete" || prior.role === "tenant";
      const saved = await updateSignupUser(session.accessToken, {
        password: body.password,
        data: { morada_signup: { ...prior, stage: finished ? "complete" : "tailor", password_set_at: new Date().toISOString(),
          ...(finished && !prior.completed_at ? { completed_at: new Date().toISOString(), preferences: null } : {}) } },
      });
      if (saved.error) {
        const code = saved.error.code;
        return NextResponse.json({ error: ["weak_password", "same_password"].includes(code) ? code : code === "reauthentication_needed" ? "session_expired" : "save_failed" }, { status: code === "reauthentication_needed" ? 401 : 400 });
      }
      return NextResponse.json({ ok: true, stage: finished ? "complete" : "tailor" });
    }

    if (!prior.password_set_at) return NextResponse.json({ error: "password_required" }, { status: 400 });
    const saved = await updateSignupUser(session.accessToken, { data: { morada_signup: {
      ...prior, stage: "complete", completed_at: new Date().toISOString(),
      preferences: prior.role === "landlord" ? body.preferences : null,
    } } });
    if (saved.error) return NextResponse.json({ error: "save_failed" }, { status: 502 });
    // Workspace creation remains with the existing /app provisioner.
    // A tenant preference never grants access to a tenancy or creates an owner workspace.
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "save_failed" }, { status: 502 });
  }
}
