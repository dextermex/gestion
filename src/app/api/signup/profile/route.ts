import { NextRequest, NextResponse } from "next/server";
import { refuseCrossOrigin } from "@/lib/gestion/api";
import { RATE, refuseOverRate } from "@/lib/gestion/rate-limit";
import { authedClient, getSession } from "@/lib/supabase/server";
import { updateSignupUser } from "@/lib/signup/update-user";
import { emailConfirmed, emailGiven, profileInput, providerAccount } from "@/lib/signup/model";

export async function POST(request: NextRequest) {
  const refused = refuseCrossOrigin(request);
  if (refused) return refused;
  const input = profileInput.safeParse(await request.json().catch(() => null));
  if (!input.success) return NextResponse.json({ error: "invalid" }, { status: 400 });
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "session_expired" }, { status: 401 });
  const db = authedClient(session.accessToken);
  // Always use a verified server-side identity. Metadata is personalization only.
  const { data: auth, error: authError } = await db.auth.getUser(session.accessToken);
  const user = auth.user;
  // A verified phone, or an Apple or Google identity (the iPhone app's rule: those accounts skip the phone). `app_metadata` is Auth's own, never the person's.
  if (authError || !user || (!user.phone_confirmed_at && !providerAccount(user))) return NextResponse.json({ error: "phone_required" }, { status: 403 });

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
        // The account system mails a confirmation to the address typed: counted on the person.
        const limited = await refuseOverRate(db.schema("gestion"), RATE.mailAccount, null);
        if (limited) return limited;
        const changed = await updateSignupUser(session.accessToken, { email });
        if (changed.error) {
          const code = changed.error.code;
          // An address another account holds is answered like any other: a code is
          // awaited, none comes, and the screen says what that may mean. Whether an
          // account exists for an address is not said here (nor at sign-in or reset).
          // The funnel then goes on exactly as for any other address (no mail arrives, and the
          // address is asked again on a later visit, as for any address never confirmed).
          const taken = code === "email_exists" || code === "user_already_exists";
          if (!taken) return NextResponse.json({ error: code === "over_email_send_rate_limit" || code === "over_request_rate_limit" ? "rate_limited" : "save_failed" }, { status: 400 });
        }
      }
      // The address is recorded and its confirmation mail goes out; the funnel does not wait for it (the owner's rule of
      // October 2026, the iPhone app's). A stage already past the password is never moved back.
      const stage = ["tailor", "complete"].includes(prior.stage) ? prior.stage : "password";
      const saved = await updateSignupUser(session.accessToken, { data: { morada_signup: { ...prior, stage } } });
      if (saved.error) return NextResponse.json({ error: "save_failed" }, { status: 502 });
      return NextResponse.json({ ok: true, emailPending: !already });
    }

    if (body.action === "email_confirmed") {
      // Auth, not the client, says whether the code or the link was accepted.
      if (!emailConfirmed(user)) return NextResponse.json({ error: "email_unconfirmed" }, { status: 409 });
      if (!["complete", "tailor", "password"].includes(prior.stage)) {
        const saved = await updateSignupUser(session.accessToken, { data: { morada_signup: { ...prior, stage: "password" } } });
        if (saved.error) return NextResponse.json({ error: "save_failed" }, { status: 502 });
      }
      return NextResponse.json({ ok: true });
    }

    // Past the e-mail step only: an address given (confirmed or pending, as Auth holds it), or the
    // e-mail step accepted by this route (an address another account holds leaves none pending).
    if (!emailGiven(user) && !["email_code", "password", "tailor", "complete"].includes(prior.stage)) return NextResponse.json({ error: "email_unconfirmed" }, { status: 409 });

    if (body.action === "password") {
      // The first password only. Changing one goes through the reset link the
      // account's address receives, never through a session alone.
      if (prior.password_set_at) return NextResponse.json({ error: "password_set" }, { status: 409 });
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
      // Setting a password withdraws every confirmation the account system had pending, the one for
      // the address just given included: the code and the link in that mail stop working. The
      // confirmation is asked again, so the mail the person opens is one that works. Never a reason
      // to fail the password: the address is asked again on a later visit if this did not go out.
      if (user.new_email) {
        const again = await updateSignupUser(session.accessToken, { email: user.new_email });
        if (again.error) console.error("signup: the address's confirmation was not re-sent after the password:", again.error.code);
      }
      return NextResponse.json({ ok: true, stage: finished ? "complete" : "tailor" });
    }

    // An Apple or Google account may finish without a password of its own (the app's second departure).
    if (!prior.password_set_at && !providerAccount(user)) return NextResponse.json({ error: "password_required" }, { status: 400 });
    const mobile = (user.user_metadata?.morada_mobile as Record<string, unknown> | undefined) ?? {};
    if (body.action === "offer") {
      // What the offer screen came to, kept as the app keeps it: bookkeeping beside the answers, never access (that is the subscription's).
      if (prior.role !== "landlord" || prior.stage !== "complete") return NextResponse.json({ error: "details_required" }, { status: 400 });
      const quiz = (mobile.quiz as Record<string, unknown> | undefined) ?? {};
      const noted = await updateSignupUser(session.accessToken, { data: { morada_mobile: {
        ...mobile, quiz: { ...quiz, offer: body.outcome }, offer: { ...body.offer, addon: false },
      } } });
      if (noted.error) return NextResponse.json({ error: "save_failed" }, { status: 502 });
      return NextResponse.json({ ok: true });
    }
    const landlord = prior.role === "landlord";
    const saved = await updateSignupUser(session.accessToken, { data: {
      morada_signup: { ...prior, stage: "complete", completed_at: prior.completed_at ?? new Date().toISOString(), preferences: landlord ? body.preferences : null },
      // The answers the iPhone app keeps (`morada_mobile.quiz`, `.dashboard`), in its shape, so either surface reads them.
      ...(landlord && (body.quiz || body.dashboard) ? { morada_mobile: {
        ...mobile,
        ...(body.quiz ? { quiz: { ...body.quiz, offer: (mobile.quiz as Record<string, unknown> | undefined)?.offer ?? null } } : {}),
        ...(body.dashboard ? { dashboard: body.dashboard } : {}),
      } } : {}),
    } });
    if (saved.error) return NextResponse.json({ error: "save_failed" }, { status: 502 });
    // The management space is opened by POST /api/espace/creer (the funnel calls it next) or by /app on first entry.
    // A tenant preference never grants access to a tenancy or creates an owner workspace.
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "save_failed" }, { status: 502 });
  }
}
