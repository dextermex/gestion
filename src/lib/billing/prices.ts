/**
 * What an add-on costs the workspace, per use, on every plan, beside what it
 * costs Morada at the provider at that moment. The rule: the provider's cost
 * plus 20 %, rounded up to the next 50 cents. The costs are the provider's
 * published prices or, where none is published, the handover's working
 * assumption; each is replaced by the signed quote. The ledger keeps both
 * figures on every row, so a change here never rewrites what was recorded.
 * Nothing here is billed to a tenant.
 */
export const ADDON_MARGIN = 0.2;

export const USAGE_KINDS = ["signature_sending", "signature_extra_signer", "signature_advanced", "signature_qualified"] as const;
export type UsageKind = (typeof USAGE_KINDS)[number];

/** The provider's cost per unit, in cents. */
export const ADDON_COST_CENTS: Record<UsageKind, number> = {
  // Youtrust API: €2.00 per signature beyond the plan's yearly quota (published).
  signature_sending: 200,
  // A signer beyond the fourth on one sending: the SMS code (included on API Pro), kept as a small unit.
  signature_extra_signer: 35,
  // Youtrust's advanced level (ID document check and SMS code) is an unpublished add-on: modelled at €2.
  signature_advanced: 200,
  // Youtrust qualified signature: €10 in yearly bundles, €15 alone (published); the higher figure.
  signature_qualified: 1500,
};

/** Signers one sending covers before each further one is counted. */
export const SIGNERS_PER_SENDING = 4;

export function priceFromCost(costCents: number): number {
  if (!Number.isFinite(costCents) || costCents <= 0) return 0;
  return Math.ceil((costCents * (1 + ADDON_MARGIN)) / 50) * 50;
}

export const ADDON_PRICE_CENTS: Record<UsageKind, number> = Object.fromEntries(USAGE_KINDS.map((k) => [k, priceFromCost(ADDON_COST_CENTS[k])])) as Record<UsageKind, number>;
