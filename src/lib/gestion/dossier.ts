import type { DemoData } from "@/lib/demo";
import type { DemoLease } from "@/lib/demo/data";
import { dossierProgress, type DossierProgress } from "@/lib/gestion/rental-flow";

/**
 * What a dossier in preparation has completed, read from the same rows the
 * property sheet reads: the people on the lease, its rent, its payer
 * binding, its guarantee, its entry inventory and its insurance, plus the
 * memory the guided flow keeps on the lease row. The property sheet, the
 * Biens card and the flow's resume page all say "3/9 étapes" from here, so
 * they cannot disagree, and a sample cabinet and a real account compute it
 * identically.
 */
export function dossierOf(demo: DemoData, lease: DemoLease): DossierProgress {
  return dossierProgress(
    {
      tenants: lease.tenantContactIds.length,
      rentCents: lease.rentCents,
      hasPayer: demo.IBAN_BINDINGS.some((b) => b.leaseId === lease.id),
      hasDeposit: demo.DEPOSITS.some((x) => x.leaseId === lease.id),
      hasInspection: demo.EDLS.some((e) => e.leaseId === lease.id && e.kind === "entry"),
      hasInsurance: demo.INSURANCES.some((i) => i.leaseId === lease.id),
    },
    lease.dossier?.completed ?? [],
  );
}
