import Link from "next/link";
import { Icon } from "@/components/pro/icons";
import { Panel } from "@/components/gestion/bits";
import TenantEmpty from "@/components/gestion/TenantEmpty";
import { getI18n } from "@/lib/i18n";
import { getTenantView } from "@/lib/portal/space";
import type { TenantDocument } from "@/lib/portal/tenant-space";
import { todoFor } from "@/lib/portal/view";
import { formatDate } from "@/lib/types";

/**
 * "Documents": every paper the tenant may open, in one place, by kind: the
 * lease and its annexes, the rent receipts, anything else the manager
 * shared on the lease. They are the same rows "Mon bail" and "Paiements"
 * show, each opened through its own signed address; a row whose file is
 * not there says so. What the tenant still owes (the insurance
 * certificate) is said at the top, with the way to send it.
 */
export default async function TenantDocumentsPage() {
  const { locale, d } = await getI18n();
  const view = await getTenantView();
  if (view.kind === "signed_out") return null;
  const { space } = view;
  const lease = space.current ?? space.past[0];
  if (!lease) return <TenantEmpty d={d} manage={view.canManage} />;
  const ended = space.current === null;
  const owesCertificate = !ended && todoFor(lease, space.payments, space.today).some((a) => a.kind === "insurance_missing");

  const isLease = (doc: TenantDocument) => doc.klass === "lease" || doc.klass === "edl";
  const groups: Array<[string, TenantDocument[]]> = [
    [d.tenant.docsLease, lease.documents.filter(isLease)],
    [d.tenant.docsReceipts, lease.documents.filter((doc) => doc.klass === "receipt")],
    [d.tenant.docsOther, lease.documents.filter((doc) => !isLease(doc) && doc.klass !== "receipt")],
  ];
  const shown = groups.filter(([, docs]) => docs.length > 0);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight text-ink">{d.tenant.navDocuments}</h1>
        <p className="mt-1 text-sm text-ink-soft">{d.tenant.docsPageSub}</p>
      </div>

      {owesCertificate && (
        <div className="rounded-2xl bg-amber-50 p-5 text-sm text-amber-900">
          <p>{d.tenant.todoInsuranceMissing}</p>
          <Link
            href="/locataire/demandes?nouvelle=attestation"
            className="tactile mt-3 inline-flex min-h-11 items-center gap-2 rounded-xl border border-sand-200 bg-white px-3.5 text-sm font-semibold text-brand-700 transition hover:border-brand-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
          >
            <Icon name="upload" size={18} className="shrink-0" />
            {d.tenant.sendCertificate}
          </Link>
        </div>
      )}

      {shown.length === 0 ? (
        <Panel title={d.tenant.docsTitle}>
          <p className="text-sm text-ink-soft">{d.tenant.docsNone}</p>
        </Panel>
      ) : (
        shown.map(([title, docs]) => (
          <Panel key={title} title={title}>
            <ul className="divide-y divide-sand-100">
              {docs.map((doc) => (
                <li key={doc.id} className="flex items-center gap-3 py-2.5">
                  <Icon name="documents" size={18} className="shrink-0 text-ink-soft" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-ink">{doc.name}</p>
                    <p className="text-xs text-ink-soft">{formatDate(doc.createdAt, locale)}</p>
                  </div>
                  {doc.url ? (
                    <a href={doc.url} target="_blank" rel="noreferrer" className="inline-flex min-h-11 shrink-0 items-center rounded-xl border border-sand-200 bg-white px-3.5 text-sm font-semibold text-brand-700 transition hover:border-brand-300">
                      {d.tenant.docOpen}
                    </a>
                  ) : (
                    <span className="shrink-0 text-xs text-ink-soft">{d.tenant.docsNoFile}</span>
                  )}
                </li>
              ))}
            </ul>
          </Panel>
        ))
      )}
    </div>
  );
}
