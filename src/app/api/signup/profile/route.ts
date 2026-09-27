import { NextRequest, NextResponse } from "next/server";
import { authedClient, getSession } from "@/lib/supabase/server";
import { updateSignupUser } from "@/lib/signup/update-user";
import { profileInput } from "@/lib/signup/model";

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
      if (user.email !== email && user.new_email !== email) {
        const changed = await updateSignupUser(session.accessToken, { email });
        if (changed.error) {
          const code = changed.error.code;
          return NextResponse.json({ error: code === "email_exists" || code === "user_already_exists" ? "email_exists" : code === "over_email_send_rate_limit" || code === "over_request_rate_limit" ? "rate_limited" : "save_failed" }, { status: 400 });
        }
      }
      const saved = await updateSignupUser(session.accessToken, { data: { morada_signup: { ...prior, stage: "tailor" } } });
      if (saved.error) return NextResponse.json({ error: "save_failed" }, { status: 502 });
      return NextResponse.json({ ok: true, emailPending: user.email !== email || !user.email_confirmed_at });
    }

    if (!user.email && !user.new_email) return NextResponse.json({ error: "email_required" }, { status: 400 });
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
