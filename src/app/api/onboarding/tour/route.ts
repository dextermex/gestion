import { NextRequest, NextResponse } from "next/server";
import { isSampleData } from "@/lib/demo";
import { refuseCrossOrigin } from "@/lib/gestion/api";
import { tourSeenOn, withTourSeen } from "@/lib/gestion/setup";
import { updateSignupUser } from "@/lib/signup/update-user";
import { getSession } from "@/lib/supabase/server";

/**
 * The first-run tour of Accueil was seen or skipped: noted on the account
 * as `morada_mobile.tour = 1`, the key the iPhone app writes, so the tour
 * plays once per account whichever surface showed it. The rest of
 * `morada_mobile` (the quiz, the offer, the trial start) is kept as it was.
 *
 * Signed in, same origin only: the session is a cookie.
 */
export async function POST(request: NextRequest) {
  const refused = refuseCrossOrigin(request);
  if (refused) return refused;
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  // A sample cabinet never plays the tour, and writes nothing.
  if (await isSampleData()) return NextResponse.json({ ok: true, sample: true });
  if (tourSeenOn(session.metadata)) return NextResponse.json({ ok: true });
  const saved = await updateSignupUser(session.accessToken, { data: { morada_mobile: withTourSeen(session.metadata) } });
  if (saved.error) return NextResponse.json({ error: "save_failed" }, { status: 502 });
  return NextResponse.json({ ok: true });
}
