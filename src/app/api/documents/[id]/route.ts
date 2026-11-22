import { NextRequest, NextResponse } from "next/server";
import { withOrg, withOrgAndClient } from "@/lib/gestion/api";
import { reclassDocument, removeDocument, type HousekeepingFailure } from "@/lib/gestion/documents";
import { DOCUMENT_CLASSES, type DocumentClass } from "@/lib/gestion/documents-rules";

/**
 * The register's housekeeping for one piece of the active workspace:
 * renamed or put on another shelf (PATCH), or taken out with its file when
 * it was filed by mistake (DELETE). What is sealed, produced by the
 * application, or named by a work order, a retention or a bill stays.
 */
const STATUS: Record<HousekeepingFailure, number> = { not_found: 404, sealed: 409, produced: 409, in_use: 409, invalid: 400, forbidden: 403, storage_failed: 502 };

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await withOrg("write");
  if (ctx instanceof NextResponse) return ctx;
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const name = typeof body.name === "string" ? body.name.slice(0, 200) : undefined;
  const klass = typeof body.class === "string" ? body.class : undefined;
  if (klass !== undefined && !DOCUMENT_CLASSES.includes(klass as DocumentClass)) return NextResponse.json({ error: "invalid", field: "class" }, { status: 400 });
  const result = await reclassDocument(ctx, id, { name, klass: klass as DocumentClass | undefined });
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: STATUS[result.error] });
  return NextResponse.json({ ok: true, ...result });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await withOrgAndClient("write");
  if (ctx instanceof NextResponse) return ctx;
  const { id } = await params;
  const result = await removeDocument(ctx, ctx.client, id);
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: STATUS[result.error] });
  return NextResponse.json({ ok: true });
}
