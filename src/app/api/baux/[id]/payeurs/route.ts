import { NextRequest, NextResponse } from "next/server";
import { withOrg, dbError } from "@/lib/gestion/api";

/**
 * The accounts a rent is expected to arrive from.
 *
 * A lease can have several: a spouse, a parent, an employer, a company. Each
 * one makes the matcher confident, none of them makes it certain — a transfer
 * from an account nobody registered still goes to review rather than being
 * refused. That is why these are bindings and not a validation rule.
 */
function normalizeIban(raw: unknown): string | null {
  const iban = String(raw ?? "").replace(/\s/g, "").toUpperCase();
  return /^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(iban) ? iban : null;
}

async function leaseOf(ctx: Awaited<ReturnType<typeof withOrg>>, id: string) {
  if (ctx instanceof NextResponse) return null;
  const { data } = await ctx.g.from("leases").select("id").eq("org_id", ctx.org.id).eq("id", id).maybeSingle();
  return data;
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await withOrg();
  if (ctx instanceof NextResponse) return ctx;
  const { g, org } = ctx;
  const { id } = await params;
  if (!(await leaseOf(ctx, id))) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const iban = normalizeIban(body.payerIban);
  if (!iban) return NextResponse.json({ error: "invalid_iban" }, { status: 400 });

  const { error } = await g
    .from("iban_bindings")
    .upsert({ org_id: org.id, payer_iban: iban, lease_id: id }, { onConflict: "org_id,payer_iban,lease_id" })
    .select("id");
  if (error) return dbError("payer binding insert", error);
  return NextResponse.json({ ok: true, payerIban: iban });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await withOrg();
  if (ctx instanceof NextResponse) return ctx;
  const { g, org } = ctx;
  const { id } = await params;
  const iban = normalizeIban(new URL(req.url).searchParams.get("iban"));
  if (!iban) return NextResponse.json({ error: "invalid_iban" }, { status: 400 });

  const { error } = await g
    .from("iban_bindings")
    .delete()
    .eq("org_id", org.id)
    .eq("lease_id", id)
    .eq("payer_iban", iban);
  if (error) return dbError("payer binding delete", error);
  return NextResponse.json({ ok: true });
}
