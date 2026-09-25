import { Badge, Card, PageHeader } from "@/components/pro/ui";
import { LegalNote, Pagination, Panel } from "@/components/gestion/bits";
import DocumentUpload from "@/components/gestion/DocumentUpload";
import { getDemo, isSampleData } from "@/lib/demo";
import { pageRequest } from "@/lib/demo/scope";
import { formatDate } from "@/lib/types";
import { getI18n } from "@/lib/i18n";
import { INTL_LOCALE, fmt, type Locale } from "@/lib/i18n/config";
import type { Dict } from "@/lib/i18n/fr";
import { shortSha } from "@/lib/documents/labels";

const CLASS_COLORS: Record<string, string> = {
  lease: "bg-brand-100 text-brand-800",
  edl: "bg-sky-100 text-sky-800",
  invoice: "bg-amber-100 text-amber-800",
  deed: "bg-violet-100 text-violet-800",
  tax: "bg-emerald-100 text-emerald-800",
  registered_letter: "bg-accent-50 text-accent-700",
  id_document: "bg-violet-100 text-violet-800",
  decompte: "bg-sky-100 text-sky-800",
  receipt: "bg-amber-100 text-amber-800",
  insurance: "bg-sky-100 text-sky-800",
  loan: "bg-violet-100 text-violet-800",
  subsidy: "bg-emerald-100 text-emerald-800",
  bank_statement: "bg-sand-100 text-ink-soft",
  photo: "bg-sand-100 text-ink-soft",
  other: "bg-sand-100 text-ink-soft",
};

const RETENTION_COLORS: Record<string, string> = {
  accounting_10y: "bg-sand-100 text-ink-soft",
  aml_5y_from_end: "bg-violet-100 text-violet-800",
  applicant_3m: "bg-red-100 text-red-700",
  gdpr_minimised: "bg-sand-100 text-ink-soft",
  permanent: "bg-emerald-100 text-emerald-800",
};

function classLabels(d: Dict): Record<string, string> {
  return {
    lease: d.documents.clsLease,
    edl: d.documents.clsEdl,
    invoice: d.documents.clsInvoice,
    deed: d.documents.clsDeed,
    tax: d.documents.clsTax,
    registered_letter: d.documents.clsLetter,
    id_document: d.documents.clsKyc,
    decompte: d.documents.clsDecompte,
    receipt: d.documents.clsReceipt,
    insurance: d.documents.clsInsurance,
    loan: d.documents.clsLoan,
    subsidy: d.documents.clsSubsidy,
    bank_statement: d.documents.clsBank,
    photo: d.documents.clsPhoto,
    other: d.documents.clsOther,
  };
}

function retentionLabels(d: Dict): Record<string, string> {
  return {
    accounting_10y: d.documents.retAccounting,
    aml_5y_from_end: d.documents.retAml,
    applicant_3m: d.documents.retApplicant,
    gdpr_minimised: d.documents.retGdpr,
    permanent: d.documents.retPermanent,
  };
}

function sizeLabel(kb: number, locale: Locale): string {
  const units = locale === "fr" || locale === "lu" ? (["Ko", "Mo"] as const) : (["KB", "MB"] as const);
  return kb >= 1024
    ? `${(kb / 1024).toLocaleString(INTL_LOCALE[locale], { maximumFractionDigits: 1 })} ${units[1]}`
    : `${kb.toLocaleString(INTL_LOCALE[locale])} ${units[0]}`;
}

export default async function DocumentsPage({ searchParams }: { searchParams: Promise<{ page?: string; taille?: string }> }) {
  const params = await searchParams;
  const { locale, d } = await getI18n();
  // The register is read a page at a time: the address names the page.
  const { DOCUMENTS, ORG, PAGING, PROPERTIES } = await getDemo({ documents: pageRequest(params) });
  const sample = await isSampleData();
  const cls = classLabels(d);
  const ret = retentionLabels(d);
  const kindLabels = d.documents.kindLabels as Record<string, string>;
  const paging = PAGING.documents;
  const hrefFor = (page: number) => `/app/documents?page=${page}${params.taille ? `&taille=${encodeURIComponent(params.taille)}` : ""}`;

  return (
    <div>
      <PageHeader
        title={d.documents.title}
        subtitle={d.documents.subtitle}
        actions={
          <DocumentUpload
            classes={Object.keys(cls).map((value) => ({ value, label: cls[value] }))}
            properties={PROPERTIES.map((p) => ({ id: p.id, label: p.name }))}
            writable={!sample}
            sampleNote={sample ? fmt(d.shell.sampleBanner, { cabinet: ORG.shortName }) : null}
            labels={{ ...d.documents, close: d.common.close }}
          />
        }
      />

      <Card className="overflow-hidden">
        <div className="table-scroll">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-sand-100 bg-sand-50/60 text-left text-[11px] uppercase tracking-wide text-ink-soft">
                <th className="px-4 py-2.5 font-semibold">{d.documents.colDoc}</th>
                <th className="px-3 py-2.5 font-semibold">{d.documents.colClass}</th>
                <th className="px-3 py-2.5 font-semibold">{d.documents.colRetention}</th>
                <th className="px-3 py-2.5 text-right font-semibold">{d.documents.colSize}</th>
                <th className="px-4 py-2.5 text-right font-semibold">{d.documents.colAdded}</th>
              </tr>
            </thead>
            <tbody>
              {DOCUMENTS.map((doc) => (
                <tr key={doc.id} className="border-b border-sand-50 last:border-0 hover:bg-sand-50/50">
                  <td className="max-w-md px-4 py-3">
                    <p className="flex items-center gap-2 truncate font-semibold text-ink">
                      {doc.sealed && (
                        <svg
                          className="h-3.5 w-3.5 shrink-0 text-brand-600"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                          strokeWidth="2"
                          role="img"
                          aria-label={d.documents.sealedAria}
                        >
                          <rect x="5" y="10" width="14" height="10" rx="2" />
                          <path d="M8 10V7a4 4 0 0 1 8 0v3" />
                        </svg>
                      )}
                      {doc.hasFile ? (
                        <a href={`/api/documents/${encodeURIComponent(doc.id)}/fichier`} className="truncate hover:text-brand-700 hover:underline" data-document-file={doc.id}>
                          {doc.name}
                        </a>
                      ) : (
                        <span className="truncate">{doc.name}</span>
                      )}
                    </p>
                    <p className="truncate text-xs text-ink-soft">
                      {doc.kind ? `${kindLabels[doc.kind] ?? doc.kind} · ` : ""}
                      {doc.relatedLabel}
                      {!sample && !doc.hasFile ? (doc.relatedLabel ? " · " : "") + d.documents.noFile : ""}
                    </p>
                    {doc.sealed && doc.sha256 && (
                      <p className="truncate text-[11px] tabular-nums text-ink-soft" title={doc.sha256} data-document-sha={doc.id}>
                        {d.documents.fingerprint} {shortSha(doc.sha256)}
                      </p>
                    )}
                  </td>
                  <td className="px-3 py-3">
                    <Badge className={CLASS_COLORS[doc.klass] ?? CLASS_COLORS.other}>
                      {cls[doc.klass] ?? cls.other}
                    </Badge>
                  </td>
                  <td className="px-3 py-3">
                    <Badge className={RETENTION_COLORS[doc.retentionClass]}>{ret[doc.retentionClass]}</Badge>
                    {doc.retentionUntil && (
                      <p className="mt-0.5 text-[11px] text-ink-soft">
                        {fmt(d.documents.until, { date: formatDate(doc.retentionUntil, locale) })}
                      </p>
                    )}
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums text-ink-soft">{sizeLabel(doc.sizeKb, locale)}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-ink-soft">{formatDate(doc.createdAt, locale)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {DOCUMENTS.length === 0 && <p className="px-4 py-6 text-sm text-ink-soft">{d.common.none}</p>}
        <div className="px-4 pb-4">
          <Pagination
            page={paging.page}
            pages={paging.pages}
            hrefFor={hrefFor}
            labels={{ prev: d.common.pagePrev, next: d.common.pageNext, pageOf: fmt(d.common.pageOf, { page: paging.page, pages: paging.pages }) }}
          />
        </div>
      </Card>

      <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-3">
        <Panel title={d.documents.clocksTitle}>
          <p className="text-sm leading-relaxed text-ink-soft">{d.documents.clocksBody}</p>
        </Panel>
        <Panel title={d.documents.residencyTitle}>
          <p className="text-sm leading-relaxed text-ink-soft">{d.documents.residencyBody}</p>
        </Panel>
        <Panel title={d.documents.holdTitle}>
          <p className="text-sm leading-relaxed text-ink-soft">{d.documents.holdBody}</p>
        </Panel>
      </div>
      <LegalNote>{d.documents.legal}</LegalNote>
    </div>
  );
}
