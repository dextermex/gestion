import { NextRequest, NextResponse } from "next/server";
import { withTenant } from "@/lib/portal/session";
import { dbError, isUuid } from "@/lib/gestion/api";
import { signedDocumentUrl } from "@/lib/gestion/documents";
import { authedClient } from "@/lib/supabase/server";

/**
 * A piece of the tenant's own tenancy, handed over when it is opened: a link
 * signed for a minute, as on the desk's side, rather than one signed for an
 * hour into every page that lists it. The portal policies decide which rows
 * and objects this account may read; a piece it may not read is not found.
 */
const PHONE_UA = /\bMobi|Android|iPhone|iPad/i;
const onPhone = (req: NextRequest): boolean => req.headers.get("sec-ch-ua-mobile") === "?1" || PHONE_UA.test(req.headers.get("user-agent") ?? "");

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await withTenant("read");
  if (ctx instanceof NextResponse) return ctx;
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const { data: doc, error } = await ctx.g.from("documents").select("id,name,storage_path").eq("id", id).maybeSingle();
  if (error) return dbError("tenant document lookup", error);
  if (!doc || !doc.storage_path) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const url = await signedDocumentUrl(authedClient(ctx.session.accessToken), String(doc.storage_path), String(doc.name), onPhone(req));
  if (!url) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.redirect(url, 302);
}
