import { NextRequest, NextResponse } from "next/server";
import { withOrgAndClient, dbError } from "@/lib/gestion/api";
import { generateDocument } from "@/lib/documents/generate";
import { sealManifest } from "@/lib/documents/manifest";

/**
 * Sealing an inventory: its items and photos, in a fixed order, hashed
 * into one manifest the session keeps from then on; the report is then
 * produced from the sealed rows when the workspace validated its template,
 * and said to be missing otherwise (the seal stands either way). A session
 * with nothing recorded, or already sealed, is refused.
 */
export const runtime = "nodejs";

type Row = Record<string, unknown>;
const s = (v: unknown): string => (typeof v === "string" ? v : "");

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await withOrgAndClient();
  if (ctx instanceof NextResponse) return ctx;
  const { g, org, client } = ctx;
  const { id } = await params;
  const { data: session, error: sErr } = await g.from("edl_sessions").select("id,kind,status,completed_at,key_handover_at,hash_manifest_sha256").eq("org_id", org.id).eq("id", id).maybeSingle();
  if (sErr) return dbError("inventory lookup", sErr);
  if (!session) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (s(session.hash_manifest_sha256)) return NextResponse.json({ error: "already" }, { status: 409 });
  const { data: items, error: iErr } = await g.from("edl_items").select("id,room,category,condition,notes").eq("org_id", org.id).eq("session_id", id);
  if (iErr) return dbError("inventory items lookup", iErr);
  const itemRows = (items ?? []) as Row[];
  if (itemRows.length === 0) return NextResponse.json({ error: "empty" }, { status: 409 });
  const { data: media, error: mErr } = await g.from("edl_media").select("id,item_id,sha256,captured_at").eq("org_id", org.id).in("item_id", itemRows.map((i) => s(i.id)));
  if (mErr) return dbError("inventory media lookup", mErr);

  const completedAt = s(session.completed_at) ? s(session.completed_at).slice(0, 10) : new Date().toISOString().slice(0, 10);
  const { sha256 } = sealManifest(
    { id, kind: s(session.kind), completedAt, keyHandoverAt: s(session.key_handover_at) ? s(session.key_handover_at).slice(0, 10) : null },
    itemRows.map((i) => ({ id: s(i.id), room: s(i.room), category: s(i.category), condition: s(i.condition), notes: s(i.notes) })),
    ((media ?? []) as Row[]).map((m) => ({ id: s(m.id), itemId: s(m.item_id), sha256: s(m.sha256), capturedAt: s(m.captured_at) })),
  );
  const { data: updated, error: uErr } = await g
    .from("edl_sessions")
    .update({ hash_manifest_sha256: sha256, status: "sealed", completed_at: s(session.completed_at) || `${completedAt}T12:00:00.000Z` })
    .eq("org_id", org.id)
    .eq("id", id)
    .select("id");
  if (uErr) return dbError("inventory seal", uErr);
  if (!updated?.length) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const report = await generateDocument(ctx, client, { kind: "edl_report", sourceId: id });
  return NextResponse.json({
    ok: true,
    sha256,
    report: "error" in report ? null : { documentId: report.documentId, name: report.name, sha256: report.sha256 },
    reportError: "error" in report ? report.error : null,
  });
}
