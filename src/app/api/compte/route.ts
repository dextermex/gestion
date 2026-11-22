import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { TEAM_EMAIL } from "@/lib/constants";
import { isSampleData } from "@/lib/demo";
import { refuseCrossOrigin } from "@/lib/gestion/api";
import { RATE, refuseOverRate } from "@/lib/gestion/rate-limit";
import { escapeHtml, mailConfigured, sendMail } from "@/lib/mail";
import { updateSignupUser } from "@/lib/signup/update-user";
import { authedClient, getSession } from "@/lib/supabase/server";

/**
 * A person's own account, saved under their own token.
 *
 *   details   first and last name, on their profile row (its own-row policy
 *             decides) and on the account's metadata, the way sign-up wrote
 *             them.
 *   sync      after a new e-mail or mobile was confirmed with the code the
 *             account system sent: the profile row takes the mobile the
 *             account system now holds.
 *   delete    records the request to erase the account, dated, on the
 *             account itself (`morada_account.deletion_requested_at`), as a
 *             row the team lists (`gestion.account_requests`, dated by the
 *             database) and by an e-mail to the team when the deployment
 *             can send one. Nothing is erased here: this application holds
 *             no service key, and leases and accounts carry retention
 *             duties a person must review. The team completes the request.
 *   restore   withdraws that request, in the same three places.
 *
 * Same origin only: the session is a cookie.
 */
const input = z.discriminatedUnion("action", [
  z.object({ action: z.literal("details"), firstName: z.string().trim().min(1).max(60), lastName: z.string().trim().min(1).max(60) }),
  z.object({ action: z.literal("sync") }),
  z.object({ action: z.literal("delete") }),
  z.object({ action: z.literal("restore") }),
]);

/**
 * The team is told: a row it can list, and an e-mail. Each is tried whatever
 * the other did; true when at least one landed. The e-mail names the account
 * by its id and address (the team answers that person) and nothing else.
 */
async function tellTheTeam(db: SupabaseClient, input: { action: "delete" | "restore"; userId: string; email: string; at: string }): Promise<boolean> {
  const requests = db.schema("gestion").from("account_requests");
  let recorded = false;
  try {
    if (input.action === "delete") {
      const { error } = await requests.insert({ kind: "deletion", email: input.email.slice(0, 320) || null });
      // 23505: a request is already open for this account, which is what was asked.
      recorded = !error || error.code === "23505";
      if (error && error.code !== "23505") console.error("account request not recorded:", error.code);
    } else {
      const { error } = await requests.update({ withdrawn_at: input.at }).eq("user_id", input.userId).is("withdrawn_at", null).is("handled_at", null);
      recorded = !error;
      if (error) console.error("account request not withdrawn:", error.code);
    }
  } catch {
    recorded = false;
  }
  let mailed = false;
  if (mailConfigured()) {
    const subject = input.action === "delete" ? "Demande de suppression de compte" : "Demande de suppression retirée";
    const lines = [
      input.action === "delete" ? "Une personne demande la suppression de son compte Morada." : "Une personne retire sa demande de suppression de compte.",
      `Compte : ${input.userId}`,
      `Adresse : ${input.email || "(aucune)"}`,
      `Date : ${input.at}`,
      input.action === "delete" ? "La demande est aussi une ligne de gestion.account_requests, à dater (handled_at) une fois traitée." : "",
    ].filter(Boolean);
    const result = await sendMail({ to: TEAM_EMAIL, subject, text: lines.join("\n"), html: lines.map((l) => `<p>${escapeHtml(l)}</p>`).join("") });
    mailed = result.sent;
  }
  return recorded || mailed;
}

export async function POST(request: NextRequest) {
  const refused = refuseCrossOrigin(request);
  if (refused) return refused;
  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid" }, { status: 400 });
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  // A sample cabinet is only ever rendered: the form answers, nothing is written.
  if (await isSampleData()) return NextResponse.json({ ok: true, sample: true });
  const db = authedClient(session.accessToken);
  const body = parsed.data;

  if (body.action === "delete" || body.action === "restore") {
    // The request sends an e-mail to the team: counted on the person.
    const limited = await refuseOverRate(db.schema("gestion"), RATE.mailAccount, null);
    if (limited) return limited;
    const previous = (session.metadata?.morada_account as Record<string, unknown> | undefined) ?? {};
    const at = new Date().toISOString();
    const saved = await updateSignupUser(session.accessToken, {
      data: { morada_account: { ...previous, deletion_requested_at: body.action === "delete" ? at : null } },
    });
    if (saved.error) return NextResponse.json({ error: "save_failed" }, { status: 502 });
    // The note on the account is what the screen reads. The team learns of
    // the request by a row it can list and by an e-mail; the answer says
    // whether either reached it, so the screen can ask the person to write
    // when neither did.
    const notified = await tellTheTeam(db, { action: body.action, userId: session.userId, email: session.email, at });
    return NextResponse.json({ ok: true, notified });
  }

  if (body.action === "details") {
    const { data, error } = await db.from("profiles").update({ first_name: body.firstName, last_name: body.lastName }).eq("id", session.userId).select("id").maybeSingle();
    if (error || !data) return NextResponse.json({ error: "save_failed" }, { status: 502 });
    const saved = await updateSignupUser(session.accessToken, { data: { first_name: body.firstName, last_name: body.lastName } });
    if (saved.error) return NextResponse.json({ error: "save_failed" }, { status: 502 });
    return NextResponse.json({ ok: true });
  }

  // The account system is the authority on how this person signs in.
  const { data: auth, error: authError } = await db.auth.getUser(session.accessToken);
  if (authError || !auth.user) return NextResponse.json({ error: "session_expired" }, { status: 401 });
  const phone = auth.user.phone ? `+${auth.user.phone.replace(/^\+/, "")}` : null;
  const { data, error } = await db.from("profiles").update({ phone }).eq("id", session.userId).select("id").maybeSingle();
  if (error || !data) return NextResponse.json({ error: "save_failed" }, { status: 502 });
  return NextResponse.json({ ok: true });
}
