import { NextRequest, NextResponse } from "next/server";
import { withOrg, dbError } from "@/lib/gestion/api";
import { loadSettlement } from "@/lib/gestion/deposit-settlement";
import { settlementOpen } from "@/lib/gestion/deposits";
import { computeSettlement } from "@/domain/deposits/settlement";

/**
 * One retention line: justified by a piece (an invoice or an estimate,
 * registered as a document of the workspace) on a date, or withdrawn.
 *
 * Whether the justification lands in time is the settlement engine's
 * verdict, re-run here with the line as it would stand: a date past the
 * statutory window forfeits the line and the answer says so, rather than a
 * rule of this route drifting from the engine's.
 */
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const str = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().slice(0, max) : "");

type Params = { params: Promise<{ id: string; lineId: string }> };

export async function PATCH(req: NextRequest, { params }: Params) {
  const ctx = await withOrg();
  if (ctx instanceof NextResponse) return ctx;
  const { g, org, userId } = ctx;
  const { id, lineId } = await params;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const today = new Date().toISOString().slice(0, 10);
  const justifiedOn = str(body.justifiedOn, 10);
  const ref = str(body.justificationRef, 160);
  if (!ISO.test(justifiedOn) || Number.isNaN(Date.parse(justifiedOn)) || justifiedOn > today || !ref) {
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }

  const loaded = await loadSettlement(ctx, id, today);
  if ("error" in loaded) return loaded.error === "not_found" ? NextResponse.json({ error: "not_found" }, { status: 404 }) : dbError(loaded.context, loaded.detail);
  const line = loaded.deductions.find((l) => l.id === lineId);
  if (!line) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (!loaded.input || !settlementOpen(loaded.deposit.status, loaded.deposit.keyHandoverOn)) return NextResponse.json({ error: "not_open" }, { status: 409 });
  if (line.justifiedAt && line.justificationDocumentId) return NextResponse.json({ error: "already" }, { status: 409 });

  // The engine's verdict on the line as it would stand once justified.
  const verdict = computeSettlement({
    ...loaded.input,
    deductions: loaded.input.deductions.map((d) => (d.id === lineId ? { ...d, justifiedAt: justifiedOn, justificationDocRef: ref } : d)),
  }).lines.find((l) => l.id === lineId);
  if (!verdict) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (verdict.status === "blocked_no_entry_edl") return NextResponse.json({ error: "blocked" }, { status: 409 });
  if (verdict.status !== "justified") {
    // Past the window: the line is forfeited, and the row says so from now on.
    if (verdict.status === "expired_forfeited") {
      await g.from("deposit_deductions").update({ status: "expired_forfeited" }).eq("org_id", org.id).eq("id", lineId);
    }
    return NextResponse.json({ error: "expired", deadline: verdict.justificationDeadline }, { status: 409 });
  }

  // The piece is a document of the workspace: a reference registered by
  // the desk, no file behind it (the same shape a scan takes later).
  const { data: doc, error: docErr } = await g
    .from("documents")
    .insert({
      org_id: org.id,
      class: "invoice",
      retention_class: "accounting_10y",
      name: ref,
      storage_path: "",
      related_type: "deposit_deduction",
      related_id: lineId,
      uploaded_by: userId,
    })
    .select("id")
    .single();
  if (docErr || !doc) return dbError("justification document insert", docErr);

  const { data, error } = await g
    .from("deposit_deductions")
    .update({ justified_at: justifiedOn, justification_document_id: doc.id, status: "justified" })
    .eq("org_id", org.id)
    .eq("id", lineId)
    .select("id");
  if (error) return dbError("deposit deduction update", error);
  if (!data?.length) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ ok: true, status: "justified", deadline: verdict.justificationDeadline });
}

/** A line that retains nothing yet may be withdrawn; a justified one is a fact. */
export async function DELETE(_req: NextRequest, { params }: Params) {
  const ctx = await withOrg();
  if (ctx instanceof NextResponse) return ctx;
  const { g, org } = ctx;
  const { id, lineId } = await params;
  const today = new Date().toISOString().slice(0, 10);

  const loaded = await loadSettlement(ctx, id, today);
  if ("error" in loaded) return loaded.error === "not_found" ? NextResponse.json({ error: "not_found" }, { status: 404 }) : dbError(loaded.context, loaded.detail);
  const line = loaded.deductions.find((l) => l.id === lineId);
  if (!line) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (!settlementOpen(loaded.deposit.status, loaded.deposit.keyHandoverOn)) return NextResponse.json({ error: "not_open" }, { status: 409 });
  if (line.justifiedAt && line.justificationDocumentId) return NextResponse.json({ error: "refused" }, { status: 409 });

  const { data, error } = await g.from("deposit_deductions").delete().eq("org_id", org.id).eq("id", lineId).eq("deposit_id", id).select("id");
  if (error) return dbError("deposit deduction delete", error);
  if (!data?.length) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
