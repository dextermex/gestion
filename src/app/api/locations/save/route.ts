import { NextRequest, NextResponse } from "next/server";
import { withOrg, dbError } from "@/lib/gestion/api";
import { parseDossierInput, saveRentalDraft } from "@/lib/gestion/rental";
import { getI18n } from "@/lib/i18n";

/**
 * The rental dossier, saved from whichever step the owner is on. The request
 * is parsed once, the work is done by `saveRentalDraft`, and the answer names
 * the draft lease, the people and where the dossier resumes, so the wizard
 * can carry on from the same canonical rows the property sheet reads. The
 * lease stays a draft; only `PATCH /api/baux/[id]` with `action: activate`
 * makes it the tenancy in force.
 */
export async function POST(req: NextRequest) {
  const ctx = await withOrg();
  if (ctx instanceof NextResponse) return ctx;
  const { d, locale } = await getI18n();

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const input = parseDossierInput(body, locale);
  if (!input) return NextResponse.json({ error: "invalid" }, { status: 400 });

  const result = await saveRentalDraft(ctx, d, input);
  if ("error" in result) {
    if (result.error === "storage_failed") return dbError(result.context, result.detail);
    return NextResponse.json({ error: result.error }, { status: result.error === "not_found" ? 404 : 409 });
  }
  return NextResponse.json(result);
}
