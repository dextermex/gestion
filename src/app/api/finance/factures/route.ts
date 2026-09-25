import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { withOrgAndClient, dbError } from "@/lib/gestion/api";
import { parseBillInput } from "@/lib/gestion/bills";
import { discardDocument, storeDocument } from "@/lib/gestion/documents";

/**
 * A bill enters the books: its piece stored in the register when one is
 * attached (an invoice for an expense, a receipt for an income), then the
 * record itself with the totals the form said and the VAT derived once.
 * A record the database refuses takes its piece with it.
 */
const str = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().slice(0, max) : "");

export async function POST(req: NextRequest) {
  const ctx = await withOrgAndClient();
  if (ctx instanceof NextResponse) return ctx;
  const { g, org, userId, client } = ctx;
  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "invalid" }, { status: 400 });
  const fields: Record<string, unknown> = {};
  for (const [key, value] of form.entries()) if (typeof value === "string") fields[key] = value;
  const parsed = parseBillInput(fields);
  if ("problem" in parsed) return NextResponse.json({ error: "invalid", problem: parsed.problem }, { status: 400 });
  const today = new Date().toISOString().slice(0, 10);

  // The lot and the supplier are this workspace's, or nothing.
  let propertyId: string | null = null;
  if (parsed.unitId) {
    const { data: unit, error } = await g.from("units").select("id,property_id").eq("org_id", org.id).eq("id", parsed.unitId).maybeSingle();
    if (error) return dbError("bill unit lookup", error);
    if (!unit) return NextResponse.json({ error: "invalid", problem: "unit" }, { status: 400 });
    propertyId = String(unit.property_id);
  }
  if (parsed.supplierContactId) {
    const { data: contact, error } = await g.from("contacts").select("id").eq("org_id", org.id).eq("id", parsed.supplierContactId).maybeSingle();
    if (error) return dbError("bill supplier lookup", error);
    if (!contact) return NextResponse.json({ error: "invalid", problem: "supplier" }, { status: 400 });
  }

  const billId = randomUUID();
  const file = form.get("file");
  let stored: { id: string; path: string } | null = null;
  if (file instanceof File && file.size > 0) {
    const result = await storeDocument(ctx, client, {
      file,
      klass: parsed.direction === "income" ? "receipt" : "invoice",
      name: str(form.get("fileName"), 160) || file.name,
      relatedType: "bill",
      relatedId: billId,
    });
    if ("error" in result) {
      const status = result.error === "unsupported_type" ? 415 : result.error === "too_large" ? 413 : 502;
      return NextResponse.json({ error: result.error }, { status });
    }
    stored = { id: result.id, path: result.path };
  }

  const { data, error } = await g
    .from("bills")
    .insert({
      id: billId,
      org_id: org.id,
      direction: parsed.direction,
      supplier_contact_id: parsed.supplierContactId,
      property_id: propertyId,
      unit_id: parsed.unitId,
      category: parsed.category,
      subject: parsed.subject,
      doc_no: parsed.docNo,
      doc_date: parsed.docDate,
      due_on: parsed.dueOn,
      paid_on: parsed.paid ? (parsed.docDate ?? today) : null,
      cashflow: parsed.cashflow,
      vat_rate_pct: parsed.vatRatePct,
      amount_cents: parsed.amountCents,
      vat_cents: parsed.vatCents,
      document_id: stored?.id ?? null,
      created_by: userId,
    })
    .select("id")
    .single();
  if (error || !data) {
    if (stored) await discardDocument(ctx, client, stored);
    return dbError("bill insert", error);
  }
  return NextResponse.json({ id: data.id, documentId: stored?.id ?? null, amountCents: parsed.amountCents, vatCents: parsed.vatCents }, { status: 201 });
}
