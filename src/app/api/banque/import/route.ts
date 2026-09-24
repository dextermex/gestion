import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { withOrg, dbError } from "@/lib/gestion/api";
import { normaliseIban, parseStatementCsv } from "@/lib/banking/csv";
import { reconcileUnmatched } from "@/lib/banking/reconcile";

/**
 * A bank statement, imported by hand: the CSV the bank exports, into an
 * account of the workspace (an existing one, or a new one named here with
 * its IBAN and its registered holder). Operations already known are left
 * aside by their stable id; the matching cascade then runs over the new
 * ones, exactly as after an API sync. Every write goes through the caller's
 * own JWT, so RLS decides; nothing here touches funds.
 */
const MAX_BYTES = 2 * 1024 * 1024;
const str = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().slice(0, max) : "");

function decode(bytes: ArrayBuffer): string {
  const utf8 = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  // A bank export in Windows-1252 shows up as replacement characters here.
  if (!utf8.includes("�")) return utf8;
  try {
    return new TextDecoder("windows-1252").decode(bytes);
  } catch {
    return utf8;
  }
}

export async function POST(req: NextRequest) {
  const ctx = await withOrg();
  if (ctx instanceof NextResponse) return ctx;
  const { g, org } = ctx;

  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "invalid" }, { status: 400 });
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "invalid" }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "too_large" }, { status: 413 });

  // The account: an existing one of the workspace, or a new manual one.
  let accountId = str(form.get("bankAccountId"), 64);
  if (accountId) {
    const { data: account, error } = await g.from("bank_accounts").select("id").eq("org_id", org.id).eq("id", accountId).maybeSingle();
    if (error) return dbError("bank account lookup", error);
    if (!account) return NextResponse.json({ error: "invalid" }, { status: 400 });
  } else {
    const label = str(form.get("label"), 120);
    const iban = normaliseIban(str(form.get("iban"), 64));
    const holder = str(form.get("holderName"), 200);
    if (!label || !iban || !holder) return NextResponse.json({ error: "invalid" }, { status: 400 });
    const { data: created, error } = await g
      .from("bank_accounts")
      .insert({ org_id: org.id, label, iban, holder_name_verbatim: holder, kind: "operating", provider: "manual" })
      .select("id")
      .single();
    if (error || !created) return dbError("bank account insert", error);
    accountId = String(created.id);
  }

  const bytes = await file.arrayBuffer();
  const parsed = parseStatementCsv(decode(bytes));
  if (parsed.rows.length === 0) return NextResponse.json({ error: "no_rows", skipped: parsed.skipped }, { status: 422 });

  const dates = parsed.rows.map((r) => r.bookedOn).sort();
  const { data: imported, error: importErr } = await g
    .from("bank_imports")
    .insert({
      org_id: org.id,
      bank_account_id: accountId,
      source: "csv",
      file_name: file.name.slice(0, 200),
      file_sha256: createHash("sha256").update(Buffer.from(bytes)).digest("hex"),
      statement_from: dates[0],
      statement_to: dates[dates.length - 1],
      tx_count: parsed.rows.length,
    })
    .select("id")
    .single();
  if (importErr || !imported) return dbError("bank import insert", importErr);

  // Idempotent on (account, bank_tx_id): a statement imported twice lands once.
  let insertedCount = 0;
  for (let i = 0; i < parsed.rows.length; i += 400) {
    const batch = parsed.rows.slice(i, i + 400).map((r) => ({
      org_id: org.id,
      bank_account_id: accountId,
      import_id: imported.id,
      booked_on: r.bookedOn,
      amount_cents: r.amountCents,
      currency: "EUR",
      counterparty_name: r.counterpartyName.slice(0, 200),
      counterparty_iban: r.counterpartyIban,
      remittance_info: r.remittanceInfo.slice(0, 500),
      end_to_end_id: r.reference ? r.reference.slice(0, 120) : null,
      bank_tx_id: r.txId.slice(0, 120),
      match_status: "unmatched",
    }));
    const { data: rows, error } = await g
      .from("bank_transactions")
      .upsert(batch, { onConflict: "bank_account_id,bank_tx_id", ignoreDuplicates: true })
      .select("id");
    if (error) return dbError("bank transactions upsert", error);
    insertedCount += (rows ?? []).length;
  }

  const matched = await reconcileUnmatched(g, org.id);
  return NextResponse.json({
    accountId,
    imported: insertedCount,
    skipped: parsed.rows.length - insertedCount,
    unreadable: parsed.skipped,
    auto: matched.auto,
    review: matched.review,
    ignored: matched.ignored,
  });
}
