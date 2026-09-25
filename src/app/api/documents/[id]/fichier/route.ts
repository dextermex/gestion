import { NextRequest, NextResponse } from "next/server";
import { withOrgAndClient, dbError } from "@/lib/gestion/api";
import { signedDocumentUrl } from "@/lib/gestion/documents";

/**
 * The file behind a piece: a short-lived signed link, named as the register
 * names it, for an account the policies let read the row and the object. A
 * reference registered without a file has nothing to hand over.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await withOrgAndClient();
  if (ctx instanceof NextResponse) return ctx;
  const { id } = await params;
  const { data: doc, error } = await ctx.g.from("documents").select("id,name,storage_path").eq("org_id", ctx.org.id).eq("id", id).maybeSingle();
  if (error) return dbError("document lookup", error);
  if (!doc || !doc.storage_path) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const url = await signedDocumentUrl(ctx.client, String(doc.storage_path), String(doc.name));
  if (!url) return NextResponse.json({ error: "storage_failed" }, { status: 502 });
  return NextResponse.redirect(url, 302);
}
