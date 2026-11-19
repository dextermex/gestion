import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isSampleData } from "@/lib/demo";
import { refuseCrossOrigin } from "@/lib/gestion/api";
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
 *             account itself (`morada_account.deletion_requested_at`).
 *             Nothing is erased here: this application holds no service key,
 *             and leases and accounts carry retention duties a person must
 *             review. The team completes the request.
 *   restore   withdraws that request.
 *
 * Same origin only: the session is a cookie.
 */
const input = z.discriminatedUnion("action", [
  z.object({ action: z.literal("details"), firstName: z.string().trim().min(1).max(60), lastName: z.string().trim().min(1).max(60) }),
  z.object({ action: z.literal("sync") }),
  z.object({ action: z.literal("delete") }),
  z.object({ action: z.literal("restore") }),
]);

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
    const previous = (session.metadata?.morada_account as Record<string, unknown> | undefined) ?? {};
    const saved = await updateSignupUser(session.accessToken, {
      data: { morada_account: { ...previous, deletion_requested_at: body.action === "delete" ? new Date().toISOString() : null } },
    });
    if (saved.error) return NextResponse.json({ error: "save_failed" }, { status: 502 });
    return NextResponse.json({ ok: true });
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
