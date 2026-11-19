import { NextResponse } from "next/server";
import { refuseWithout, withOrg } from "@/lib/gestion/api";
import { RATE, refuseOverRate } from "@/lib/gestion/rate-limit";
import {
  SaltEdgeError,
  ensureCustomer,
  listAccounts,
  listConnections,
  listTransactions,
  saltEdgeConfigured,
} from "@/lib/banking/saltedge";
import { mapAccountRow, mapTransactionRow } from "@/lib/banking/mapping";
import { reconcileUnmatched } from "@/lib/banking/reconcile";

/**
 * Pulls the workspace's Salt Edge connections into gestion.bank_accounts and
 * gestion.bank_transactions. Every write goes through the caller's own JWT,
 * so RLS decides row by row; there is no service key anywhere. Imports are
 * idempotent: accounts key on (org, provider, provider_account_id),
 * transactions on (bank_account_id, bank_tx_id).
 *
 * It writes, so it is a write like any other: this application's own pages,
 * a workspace that is not locked, a member who may edit its finances (asked
 * before the provider is called, not discovered at the first refused row),
 * and a count of the runs.
 */
export async function POST() {
  const ctx = await withOrg("write");
  if (ctx instanceof NextResponse) return ctx;
  if (!saltEdgeConfigured()) return NextResponse.json({ error: "not_configured" }, { status: 503 });
  const { g, org } = ctx;
  const refused = await refuseWithout(ctx, "gestion.finance.edit");
  if (refused) return refused;
  const limited = await refuseOverRate(g, RATE.bankSync, org.id);
  if (limited) return limited;

  try {
    const customerId = await ensureCustomer(`morada-ws-${org.id}`);
    const connections = await listConnections(customerId);
    const nowIso = new Date().toISOString();
    let accountCount = 0;
    let txCount = 0;

    for (const conn of connections) {
      const accounts = await listAccounts(conn.id);
      for (const a of accounts) {
        const { data: acctRow, error: acctErr } = await g
          .from("bank_accounts")
          .upsert(mapAccountRow(a, org.id, conn.id, nowIso), {
            onConflict: "org_id,provider,provider_account_id",
          })
          .select("id")
          .single();
        if (acctErr || !acctRow) {
          // PGRST106: the schema is not exposed to the API; 42501: RLS said no.
          const code = (acctErr as { code?: string } | null)?.code;
          if (code === "PGRST106") return NextResponse.json({ error: "schema_unexposed" }, { status: 503 });
          if (code === "42501") return NextResponse.json({ error: "forbidden" }, { status: 403 });
          console.error("bank account upsert failed:", acctErr);
          return NextResponse.json({ error: "storage_failed" }, { status: 502 });
        }
        accountCount += 1;

        const txs = await listTransactions(conn.id, a.id);
        for (let i = 0; i < txs.length; i += 400) {
          const batch = txs.slice(i, i + 400).map((t) => mapTransactionRow(t, org.id, acctRow.id));
          const { error: txErr } = await g
            .from("bank_transactions")
            .upsert(batch, { onConflict: "bank_account_id,bank_tx_id", ignoreDuplicates: true });
          if (txErr) {
            console.error("bank tx upsert failed:", txErr);
            return NextResponse.json({ error: "storage_failed" }, { status: 502 });
          }
        }
        txCount += txs.length;
      }
    }

    // The matching engine runs on what just landed: RF first, learned IBAN,
    // then fuzzy — auto matches become payments + FIFO allocations, the rest
    // queues for review. Paid-ness stays derived from allocations.
    const matched = await reconcileUnmatched(g, org.id);

    return NextResponse.json({
      connections: connections.length,
      accounts: accountCount,
      transactions: txCount,
      matched,
    });
  } catch (e) {
    if (e instanceof SaltEdgeError) {
      console.error("saltedge sync failed:", `${e.code}: ${e.message}`);
      // The class of the refusal, never its message; a provider that did not answer in time says so.
      return NextResponse.json({ error: "saltedge_error", code: e.code }, { status: e.code === "timeout" ? 504 : 502 });
    }
    console.error("saltedge sync failed:", e instanceof Error ? e.name : "error");
    return NextResponse.json({ error: "saltedge_error", code: "network" }, { status: 502 });
  }
}
