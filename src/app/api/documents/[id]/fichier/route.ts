import { NextRequest, NextResponse } from "next/server";
import { withOrgAndClient, dbError } from "@/lib/gestion/api";
import { signedDocumentUrl } from "@/lib/gestion/documents";
import { answerNavigation } from "@/lib/http/navigation";

/**
 * The file behind a piece: a short-lived signed link, named as the register
 * names it, for an account the policies let read the row and the object. A
 * reference registered without a file has nothing to hand over. A phone
 * gets the file shown in the tab rather than saved to a folder it will not
 * find again; a laptop keeps the download. Every "Ouvrir" of the app is a
 * plain link to this handler: when there is nothing to hand over, a person
 * is sent to a screen that says so (`answerNavigation`), a script keeps the
 * JSON error.
 */
const PHONE_UA = /\bMobi|Android|iPhone|iPad/i;
const onPhone = (req: NextRequest): boolean => req.headers.get("sec-ch-ua-mobile") === "?1" || PHONE_UA.test(req.headers.get("user-agent") ?? "");

export async function GET(req: NextRequest, route: { params: Promise<{ id: string }> }) {
  return answerNavigation(req, await file(req, route));
}

async function file(req: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const ctx = await withOrgAndClient();
  if (ctx instanceof NextResponse) return ctx;
  const { id } = await params;
  const { data: doc, error } = await ctx.g.from("documents").select("id,name,storage_path").eq("org_id", ctx.org.id).eq("id", id).maybeSingle();
  if (error) return dbError("document lookup", error);
  if (!doc || !doc.storage_path) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const url = await signedDocumentUrl(ctx.client, String(doc.storage_path), String(doc.name), onPhone(req));
  if (!url) return NextResponse.json({ error: "storage_failed" }, { status: 502 });
  return NextResponse.redirect(url, 302);
}
