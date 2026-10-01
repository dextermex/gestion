import Link from "next/link";
import { Card, EmptyState, PageHeader } from "@/components/pro/ui";
import { Icon } from "@/components/pro/icons";
import { CollapsiblePanel, LegalNote, Pagination, Panel } from "@/components/gestion/bits";
import DocumentUpload from "@/components/gestion/DocumentUpload";
import DocumentList, { type DocumentRow } from "@/components/gestion/DocumentList";
import DocumentFilters from "@/components/gestion/DocumentFilters";
import { getDemo, isSampleData } from "@/lib/demo";
import { pageRequest, type DocumentFilter } from "@/lib/demo/scope";
import { DOCUMENT_GROUPS, DOCUMENT_GROUP_KEYS, isDocumentGroup, type DocumentGroup } from "@/lib/gestion/documents-rules";
import { filterDocuments, searchWords } from "@/lib/documents/summary";
import { recognitionConfigured } from "@/lib/documents/recognition";
import { shortSha, sizeLabel } from "@/lib/documents/labels";
import { formatDate } from "@/lib/types";
import { getI18n } from "@/lib/i18n";
import { fmt, plural } from "@/lib/i18n/config";
import type { Dict } from "@/lib/i18n/fr";

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

function groupLabels(d: Dict): Record<DocumentGroup, string> {
  return {
    tenancy: d.documents.grpTenancy,
    money: d.documents.grpMoney,
    letters: d.documents.grpLetters,
    statements: d.documents.grpStatements,
    title: d.documents.grpTitle,
    tax: d.documents.grpTax,
    kyc: d.documents.grpKyc,
    insurance: d.documents.grpInsurance,
    other: d.documents.grpOther,
  };
}

type Params = { page?: string; taille?: string; groupe?: string; q?: string; vue?: string };

/**
 * The register. What it holds leads (how many pieces, how many sealed,
 * the shelves), the clocks about to run out sit beside it, then the
 * pieces themselves behind a shelf and a search, one page at a time. A
 * row opens its sheet; the name opens the file. A real account's page is
 * narrowed on the server; a sample cabinet, read whole, is narrowed here.
 */
export default async function DocumentsPage({ searchParams }: { searchParams: Promise<Params> }) {
  const params = await searchParams;
  const { locale, d } = await getI18n();
  const group: DocumentGroup | null = isDocumentGroup(params.groupe) ? params.groupe : null;
  const query = (params.q ?? "").trim().slice(0, 120);
  const words = searchWords(query);
  const purge = params.vue === "purge";
  const filter: DocumentFilter = { classes: group ? DOCUMENT_GROUPS[group] : undefined, words, purgeSoon: purge };
  const data = await getDemo({ documents: pageRequest(params), documentFilter: filter });
  const sample = await isSampleData();
  const { ORG, PROPERTIES, TODAY, DOCUMENT_SUMMARY: summary } = data;
  const documents = sample ? filterDocuments(data.DOCUMENTS, filter, TODAY) : data.DOCUMENTS;
  const paging = sample ? { page: 1, pages: 1, total: documents.length } : data.PAGING.documents;
  const cls = classLabels(d);
  const ret = retentionLabels(d);
  const grp = groupLabels(d);
  const kindLabels = d.documents.kindLabels as Record<string, string>;
  const filtering = group !== null || words.length > 0 || purge;

  const hrefFor = (page: number) => {
    const p = new URLSearchParams();
    p.set("page", String(page));
    if (params.taille) p.set("taille", params.taille);
    if (group) p.set("groupe", group);
    if (query) p.set("q", query);
    if (purge) p.set("vue", "purge");
    return `/app/documents?${p.toString()}`;
  };

  const rows: DocumentRow[] = documents.map((doc) => ({
    id: doc.id,
    name: doc.name,
    sealed: doc.sealed,
    hasFile: doc.hasFile,
    classLabel: cls[doc.klass] ?? cls.other,
    kindLabel: doc.kind ? (kindLabels[doc.kind] ?? doc.kind) : null,
    relatedLabel: doc.relatedLabel,
    addedLabel: formatDate(doc.createdAt, locale),
    sizeLabel: sizeLabel(doc.sizeKb, locale),
    retentionLabel: ret[doc.retentionClass] ?? doc.retentionClass,
    retentionUntilLabel: doc.retentionUntil ? fmt(d.documents.until, { date: formatDate(doc.retentionUntil, locale) }) : null,
    sha256: doc.sha256 ?? null,
    shortSha: doc.sha256 ? shortSha(doc.sha256) : null,
    fileHref: doc.hasFile ? `/api/documents/${encodeURIComponent(doc.id)}/fichier` : null,
  }));

  const shelves = DOCUMENT_GROUP_KEYS.filter((g) => summary.byGroup[g] > 0);
  const registerSub = [
    plural(locale, summary.sealed, d.documents.sealedOne, d.documents.sealedMany),
    summary.unfiled > 0 ? fmt(d.documents.unfiled, { n: summary.unfiled }) : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const listTitle = purge ? d.documents.purgeView : group ? grp[group] : d.documents.listTitle;
  const resetLink = (
    <Link href="/app/documents" className="inline-flex min-h-10 items-center text-sm font-semibold text-brand-700 hover:underline">
      {d.common.resetFilters}
    </Link>
  );

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
            recognition={recognitionConfigured()}
            locale={locale}
          />
        }
      />

      {summary.total === 0 && documents.length === 0 && !filtering ? (
        <EmptyState icon="documents" title={d.documents.emptyTitle} body={d.documents.emptyBody} />
      ) : (
        <>
          <section className="crm-doc-overview" aria-label={d.documents.registerTitle}>
            {/* The register leads: how much it holds, how much of it is sealed, and its shelves. */}
            <Card className="crm-metric crm-doc-hero">
              <div className="crm-metric-top">
                <span>{d.documents.registerTitle}</span>
                <span className="crm-symbol">
                  <Icon name="documents" size={22} />
                </span>
              </div>
              <p className="crm-metric-value">{summary.total}</p>
              <p className="crm-metric-sub">{registerSub}</p>
              {shelves.length > 0 && (
                <ul className="crm-doc-groups">
                  {shelves.map((g) => (
                    <li key={g}>
                      <Link href={`/app/documents?groupe=${g}`} aria-current={group === g && !purge ? "page" : undefined}>
                        <span>{grp[g]}</span>
                        <span>{summary.byGroup[g]}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card className={"crm-metric" + (summary.purgeDue > 0 ? " crm-metric-attention" : "")}>
              <div className="crm-metric-top">
                <span>{d.documents.clocksTitle}</span>
                <span className="crm-symbol">
                  <Icon name="clock" size={22} />
                </span>
              </div>
              <p className="crm-metric-value">{summary.purgeDue}</p>
              <p className="crm-metric-sub">{summary.nextPurge ? fmt(d.documents.purgeNext, { date: formatDate(summary.nextPurge, locale) }) : d.documents.purgeNone}</p>
              {summary.purgeDue > 0 && (
                <Link href="/app/documents?vue=purge" className="crm-metric-action">
                  {d.documents.purgeAction}
                  <Icon name="chevron-right" size={15} />
                </Link>
              )}
            </Card>

            <Card className="crm-metric">
              <div className="crm-metric-top">
                <span>{d.documents.producedTitle}</span>
                <span className="crm-symbol">
                  <Icon name="contract" size={22} />
                </span>
              </div>
              <p className="crm-metric-value">{summary.generated}</p>
              <p className="crm-metric-sub">{d.documents.producedSub}</p>
            </Card>
          </section>

          <Panel title={listTitle}>
            <DocumentFilters
              group={group ?? ""}
              q={query}
              purge={purge}
              labels={{
                search: d.documents.search,
                group: d.documents.filterGroup,
                all: d.documents.grpAll,
                reset: d.common.resetFilters,
                groups: DOCUMENT_GROUP_KEYS.map((g) => ({ value: g, label: grp[g] })),
              }}
            />
            {rows.length === 0 ? (
              <EmptyState title={d.documents.filteredTitle} body={d.documents.filteredBody} action={resetLink} />
            ) : (
              <>
                <DocumentList
                  rows={rows}
                  labels={{
                    colDoc: d.documents.colDoc,
                    colClass: d.documents.colClass,
                    colAdded: d.documents.colAdded,
                    colSize: d.documents.colSize,
                    details: d.documents.details,
                    close: d.common.close,
                    openFile: d.documents.openFile,
                    klass: d.documents.klass,
                    related: d.documents.related,
                    relatedNone: d.documents.relatedNone,
                    added: d.documents.sheetAdded,
                    size: d.documents.colSize,
                    retention: d.documents.colRetention,
                    kind: d.documents.sheetKind,
                    fingerprint: d.documents.fingerprint,
                    sealed: d.documents.sealedAria,
                    sealedNote: d.documents.sealedNote,
                    noFile: sample ? null : d.documents.noFile,
                  }}
                />
                <div className="crm-doc-foot">
                  <p className="crm-bank-count">{fmt(d.documents.countShown, { shown: rows.length, total: paging.total })}</p>
                  <Pagination
                    page={paging.page}
                    pages={paging.pages}
                    hrefFor={hrefFor}
                    labels={{ prev: d.common.pagePrev, next: d.common.pageNext, pageOf: fmt(d.common.pageOf, { page: paging.page, pages: paging.pages }) }}
                  />
                </div>
              </>
            )}
          </Panel>
        </>
      )}

      <CollapsiblePanel title={d.documents.refTitle} className="mt-5">
        <div className="crm-doc-reference">
          <div>
            <h3>{d.documents.clocksTitle}</h3>
            <p>{d.documents.clocksBody}</p>
          </div>
          <div>
            <h3>{d.documents.residencyTitle}</h3>
            <p>{d.documents.residencyBody}</p>
          </div>
          <div>
            <h3>{d.documents.holdTitle}</h3>
            <p>{d.documents.holdBody}</p>
          </div>
        </div>
        <LegalNote>{d.documents.legal}</LegalNote>
      </CollapsiblePanel>
    </div>
  );
}
