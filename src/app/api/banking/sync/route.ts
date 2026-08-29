import { NextResponse } from "next/server";
import { getSession, authedClient } from "@/lib/supabase/server";
import { getIdentity } from "@/lib/workspace";
import {
  SaltEdgeError,
  ensureCustomer,
  listAccounts,
  listConnections,
  listTransactions,
  saltEdgeConfigured,
} from "@/lib/banking/saltedge";
import { mapAccountRow, mapTransactionRow } from "@/lib/banking/mapping";

/**
 * Pulls the workspace's Salt Edge connections into gestion.bank_accounts and
 * gestion.bank_transactions. Every write goes through the caller's own JWT,
 * so RLS decides row by row; there is no service key anywhere. Imports are
 * idempotent: accounts key on (org, provider, provider_account_id),
 * transactions on (bank_account_id, bank_tx_id).
 */
export async function POST() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if (!saltEdgeConfigured()) return NextResponse.json({ error: "not_configured" }, { status: 503 });

  const identity = await getIdentity();
  const org = identity?.active;
  if (!org) return NextResponse.json({ error: "no_workspace" }, { status: 403 });

  try {
    const customerId = await ensureCustomer(`morada-ws-${org.id}`);
    const connections = await listConnections(customerId);
    const g = authedClient(session.accessToken).schema("gestion");
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

    return NextResponse.json({ connections: connections.length, accounts: accountCount, transactions: txCount });
  } catch (e) {
    console.error("saltedge sync failed:", e instanceof SaltEdgeError ? `${e.code}: ${e.message}` : e);
    return NextResponse.json({ error: "saltedge_error" }, { status: 502 });
  }
}
