import { NextRequest, NextResponse } from "next/server";
import { withOrg, dbError } from "@/lib/gestion/api";

/** A draft décompte is discarded with its lines; an issued one is a fact the tenant received. */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await withOrg();
  if (ctx instanceof NextResponse) return ctx;
  const { g, org } = ctx;
  const { id } = await params;

  const { data: period, error: readErr } = await g.from("charge_periods").select("id,status").eq("org_id", org.id).eq("id", id).maybeSingle();
  if (readErr) return dbError("charge period lookup", readErr);
  if (!period) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (period.status !== "draft") return NextResponse.json({ error: "not_draft" }, { status: 409 });

  const { data, error } = await g.from("charge_periods").delete().eq("org_id", org.id).eq("id", id).eq("status", "draft").select("id");
  if (error) return dbError("charge period delete", error);
  if (!data?.length) return NextResponse.json({ error: "not_draft" }, { status: 409 });
  return NextResponse.json({ ok: true });
}
