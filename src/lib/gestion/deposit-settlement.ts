import "server-only";
import type { OrgContext } from "@/lib/gestion/api";
import { computeSettlement, type SettlementInput, type SettlementResult } from "@/domain/deposits/settlement";
import type { DepositForm } from "@/domain/lease/rules";
import type { DepositStatus } from "@/lib/types";

/**
 * A guarantee and everything its settlement is computed from, read under
 * the caller's token: the deposit row, the tenancy's rent, whether a signed
 * entry inventory exists, and the retention lines. The engine then says
 * what is due; the routes only record what it decided.
 */
export interface DepositRow {
  id: string;
  leaseId: string;
  form: DepositForm;
  amountCents: number;
  status: DepositStatus;
  receivedOn: string | null;
  keyHandoverOn: string | null;
  decompteIssuedOn: string | null;
  miseEnDemeureArOn: string | null;
  releasedFirstTrancheCents: number;
  releasedBalanceCents: number;
}

export interface DeductionRow {
  id: string;
  kind: "arrears" | "damage" | "charge_reserve";
  label: string;
  amountCents: number;
  justifiedAt: string | null;
  justificationDocumentId: string | null;
  edlItemId: string | null;
  status: string;
}

export interface LoadedSettlement {
  deposit: DepositRow;
  monthlyRentCents: number;
  entryEdlExists: boolean;
  deductions: DeductionRow[];
  /** Null while the keys are not back: there is no settlement to compute yet. */
  input: SettlementInput | null;
  settlement: SettlementResult | null;
}

export type SettlementLoadFailure = { error: "not_found" } | { error: "storage_failed"; context: string; detail: { code?: string; message?: string } | null };

const s = (v: unknown): string => (v == null ? "" : String(v));
const dayOrNull = (v: unknown): string | null => (v ? s(v).slice(0, 10) : null);

export async function loadSettlement(ctx: OrgContext, depositId: string, today: string): Promise<LoadedSettlement | SettlementLoadFailure> {
  const { g, org } = ctx;
  const { data: dep, error: depErr } = await g
    .from("deposits")
    .select("id,lease_id,form,amount_cents,status,received_on,key_handover_on,decompte_issued_on,mise_en_demeure_ar_on,released_first_tranche_cents,released_balance_cents")
    .eq("org_id", org.id)
    .eq("id", depositId)
    .maybeSingle();
  if (depErr) return { error: "storage_failed", context: "deposit lookup", detail: depErr };
  if (!dep) return { error: "not_found" };
  const deposit: DepositRow = {
    id: s(dep.id),
    leaseId: s(dep.lease_id),
    form: s(dep.form) as DepositForm,
    amountCents: Number(dep.amount_cents) || 0,
    status: s(dep.status) as DepositStatus,
    receivedOn: dayOrNull(dep.received_on),
    keyHandoverOn: dayOrNull(dep.key_handover_on),
    decompteIssuedOn: dayOrNull(dep.decompte_issued_on),
    miseEnDemeureArOn: dayOrNull(dep.mise_en_demeure_ar_on),
    releasedFirstTrancheCents: Number(dep.released_first_tranche_cents) || 0,
    releasedBalanceCents: Number(dep.released_balance_cents) || 0,
  };

  const [{ data: lease, error: leaseErr }, { data: edl, error: edlErr }, { data: lines, error: linesErr }] = await Promise.all([
    g.from("leases").select("id,rent_cents").eq("org_id", org.id).eq("id", deposit.leaseId).maybeSingle(),
    g.from("edl_sessions").select("id").eq("org_id", org.id).eq("lease_id", deposit.leaseId).eq("kind", "entry").in("status", ["signed", "sealed"]).limit(1),
    g.from("deposit_deductions").select("id,kind,label,amount_cents,justified_at,justification_document_id,edl_item_id,status").eq("org_id", org.id).eq("deposit_id", depositId),
  ]);
  if (leaseErr) return { error: "storage_failed", context: "deposit lease lookup", detail: leaseErr };
  if (edlErr) return { error: "storage_failed", context: "entry inventory lookup", detail: edlErr };
  if (linesErr) return { error: "storage_failed", context: "deposit deductions read", detail: linesErr };

  const deductions: DeductionRow[] = ((lines as Array<Record<string, unknown>> | null) ?? []).map((x) => ({
    id: s(x.id),
    kind: s(x.kind) as DeductionRow["kind"],
    label: s(x.label),
    amountCents: Number(x.amount_cents) || 0,
    justifiedAt: dayOrNull(x.justified_at),
    justificationDocumentId: x.justification_document_id ? s(x.justification_document_id) : null,
    edlItemId: x.edl_item_id ? s(x.edl_item_id) : null,
    status: s(x.status),
  }));
  const entryEdlExists = ((edl as unknown[] | null) ?? []).length > 0;
  const monthlyRentCents = Number(lease?.rent_cents) || 0;

  const input: SettlementInput | null = deposit.keyHandoverOn
    ? {
        depositAmount: deposit.amountCents,
        depositForm: deposit.form,
        monthlyRent: monthlyRentCents,
        keyHandoverDate: deposit.keyHandoverOn,
        decompteIssuedAt: deposit.decompteIssuedOn,
        entryEdlExists,
        deductions: deductions.map((x) => ({
          id: x.id,
          kind: x.kind,
          label: x.label,
          amount: x.amountCents,
          justificationDocRef: x.justificationDocumentId ?? undefined,
          justifiedAt: x.justifiedAt ?? undefined,
          edlItemRef: x.edlItemId ?? undefined,
        })),
        miseEnDemeureArDate: deposit.miseEnDemeureArOn,
        releasedFirstTranche: deposit.releasedFirstTrancheCents,
        releasedBalance: deposit.releasedBalanceCents,
        asOf: today,
      }
    : null;
  return { deposit, monthlyRentCents, entryEdlExists, deductions, input, settlement: input ? computeSettlement(input) : null };
}
