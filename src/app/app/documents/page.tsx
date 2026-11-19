import Link from "next/link";
import { EmptyState, PageHeader } from "@/components/pro/ui";
import { Icon } from "@/components/pro/icons";
import { CollapsiblePanel, LegalNote, Pagination } from "@/components/gestion/bits";
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

  const upload = (
    <DocumentUpload
      classes={Object.keys(cls).map((value) => ({ value, label: cls[value] }))}
      properties={PROPERTIES.map((p) => ({ id: p.id, label: p.name }))}
      writable={!sample}
      sampleNote={sample ? fmt(d.shell.sampleBanner, { cabinet: ORG.shortName }) : null}
      labels={{ ...d.documents, close: d.common.close }}
      recognition={recognitionConfigured()}
      locale={locale}
    />
  );
  const pieces = (n: number) => plural(locale, n, d.documents.piecesOne, d.documents.piecesMany);
  // The shelves are the folders: where the register files a piece by its class. One address each.
  const folders: Array<{ key: string; href: string; label: string; count: number; current: boolean; tone?: "late" }> = [
    { key: "all", href: "/app/documents", label: d.documents.allDocs, count: summary.total, current: !filtering },
    ...shelves.map((g) => ({ key: g, href: `/app/documents?groupe=${g}`, label: grp[g], count: summary.byGroup[g], current: group === g && !purge })),
    ...(summary.purgeDue > 0 ? [{ key: "purge", href: "/app/documents?vue=purge", label: d.documents.purgeFolder, count: summary.purgeDue, current: purge, tone: "late" as const }] : []),
  ];
  const empty = summary.total === 0 && documents.length === 0 && !filtering;

  return (
    <div>
      <PageHeader title={d.documents.title} subtitle={d.documents.lead} actions={upload} />

      {empty ? (
        <EmptyState icon="documents" title={d.documents.emptyTitle} body={d.documents.emptyBody} />
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[15.5rem_minmax(0,1fr)] lg:gap-8">
          {/* The folder column: a rail of chips on a phone, a list beside the files from `lg`. */}
          <nav aria-label={d.documents.foldersAria} className="min-w-0 lg:sticky lg:top-24 lg:self-start">
            <p className="mb-2 px-1 text-sm font-semibold text-ink-soft max-lg:hidden">{d.documents.foldersTitle}</p>
            <ul className="scroll-x flex gap-1.5 lg:flex-col lg:gap-0.5">
              {folders.map((f) => (
                <li key={f.key} className="shrink-0">
                  <Link
                    href={f.href}
                    aria-current={f.current ? "page" : undefined}
                    className={
                      "tactile flex min-h-11 items-center gap-2.5 rounded-2xl px-3.5 text-[15px] font-semibold transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 max-lg:border max-lg:border-sand-200 max-lg:bg-white/80 " +
                      (f.current ? "bg-brand-50 text-brand-800 max-lg:border-brand-200" : "text-ink-soft hover:bg-white/80 hover:text-ink")
                    }
                  >
                    <Icon name={f.key === "purge" ? "clock" : "folder"} size={18} className={"shrink-0 " + (f.tone === "late" ? "text-red-700" : "")} />
                    <span className="min-w-0 flex-1 truncate">{f.label}</span>
                    <span className={"shrink-0 text-[13px] tabular-nums " + (f.tone === "late" ? "font-semibold text-red-700" : "font-medium text-ink-soft")}>{f.count}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          <div className="min-w-0">
            {/* What the register holds, in one line. */}
            <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 rounded-3xl border border-sand-200/80 bg-white/75 px-5 py-4">
              <div className="min-w-0">
                <p className="text-[15px] font-semibold text-ink">{pieces(summary.total)}</p>
                <p className="mt-0.5 text-[13px] text-ink-soft">
                  {[registerSub, summary.generated > 0 ? plural(locale, summary.generated, d.documents.producedOne, d.documents.producedMany) : null].filter(Boolean).join(" · ")}
                </p>
              </div>
              {summary.purgeDue > 0 && summary.nextPurge && (
                <Link href="/app/documents?vue=purge" className="inline-flex min-h-10 items-center gap-1.5 rounded-full border border-red-200 bg-red-50 px-3.5 text-sm font-semibold text-red-700 hover:bg-red-100">
                  <Icon name="clock" size={15} />
                  {fmt(d.documents.purgeNext, { date: formatDate(summary.nextPurge, locale) })}
                </Link>
              )}
            </div>

            {/* The folders as tiles, while the whole register is on the screen. */}
            {!filtering && shelves.length > 0 && (
              <section className="mt-7">
                <div className="mb-3 flex items-baseline justify-between gap-3 px-1">
                  <h2 className="font-display text-lg font-bold text-ink">{d.documents.foldersTitle}</h2>
                  <p className="text-sm text-ink-soft">{fmt(d.documents.foldersCount, { n: shelves.length })}</p>
                </div>
                <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
                  {shelves.map((g) => (
                    <li key={g} className="min-w-0">
                      <Link href={`/app/documents?groupe=${g}`} className="tactile block h-full rounded-3xl border border-sand-200/80 bg-white/75 p-4 transition hover:border-brand-200 hover:bg-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600">
                        <span className="grid h-10 w-10 place-items-center rounded-2xl bg-brand-50 text-brand-700">
                          <Icon name="folder" size={20} />
                        </span>
                        <span className="mt-4 block truncate text-[15px] font-semibold text-ink">{grp[g]}</span>
                        <span className="mt-0.5 block text-[13px] text-ink-soft">{pieces(summary.byGroup[g])}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <section className="mt-7">
              <div className="mb-3 flex items-baseline justify-between gap-3 px-1">
                <h2 className="font-display text-lg font-bold text-ink">{filtering ? listTitle : d.documents.filesTitle}</h2>
                <p className="text-sm text-ink-soft">{pieces(paging.total)}</p>
              </div>
              <div className="rounded-3xl border border-sand-200/80 bg-white/75 p-4 sm:p-5">
                <DocumentFilters
                  // Keyed on the address's own search and shelf: the box never keeps words the list is no longer filtered by.
                  key={`${group ?? ""}:${query}:${purge ? "purge" : ""}`}
                  shelf={false}
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
              </div>
            </section>
          </div>
        </div>
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
