import { Icon } from "@/components/pro/icons";
import Link from "next/link";
import { ContactLink } from "@/components/gestion/ContactLink";
import { notFound } from "next/navigation";
import { Badge } from "@/components/pro/ui";
import { LegalNote, MetaBadge, Panel, Timeline } from "@/components/gestion/bits";
import { getDemo, isSampleData } from "@/lib/demo";
import {
  amlTierMeta,
  contactRoleMeta,
  euros,
  formatDate,
  initials,
  leaseStatusMeta,
  riskBandMeta,
} from "@/lib/types";
import { getI18n } from "@/lib/i18n";
import { fmt } from "@/lib/i18n/config";
import ModifyMenu from "@/components/gestion/ModifyMenu";
import { contactMenu } from "@/lib/gestion/contact-menu";
import { modifyLabels } from "@/app/app/biens/[id]/sheet";

// No generateStaticParams: the page reads the locale cookie, so it must be
// request-rendered — a build-time prerender would bake one language in.

export default async function ContactDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { locale, d } = await getI18n();
  const { CONTACTS, FISCAL_YEARS, LEASES, TICKETS, IBAN_BINDINGS, leaseTenantNames, leaseUnitLabel } = await getDemo();
  const contact = CONTACTS.find((c) => c.id === id);
  if (!contact) notFound();
  const c = contact!;
  const roleMeta = contactRoleMeta(d);
  const statusMeta = leaseStatusMeta(d);
  const amlMeta = amlTierMeta(d);
  const riskMeta = riskBandMeta(d);

  const leases = LEASES.filter((l) => l.tenantContactIds.includes(c.id));
  const tickets = TICKETS.filter((t) => t.artisanContactId === c.id);
  const isOwner = c.roles.includes("owner");
  // The accounts their rent was seen coming from, bound to their leases: a fact of the ledger, never a placeholder.
  const payerIbans = [...new Set(IBAN_BINDINGS.filter((b) => leases.some((l) => l.id === b.leaseId)).map((b) => b.payerIban))].filter((iban) => iban !== c.iban);
  // Where an owner's buttons lead must exist: the management statements are the sample
  // mandate's (Finance, Comptabilité), the tax pack exists for an owner with a prepared exercise.
  const statementsHref = isOwner && (await isSampleData()) ? "/app/finance?vue=comptabilite" : null;
  const taxPackHref = isOwner && FISCAL_YEARS.some((y) => y.ownerContactId === c.id) ? `/app/fiscalite?proprietaire=${encodeURIComponent(c.id)}&vue=detail` : null;

  const timeline = [
    ...(c.id === "c-muller"
      ? [
          { kind: "ticket", label: d.contacts.tlMullerTicket, sub: d.contacts.tlMullerTicketSub, at: formatDate("2026-08-19", locale) },
          { kind: "payment", label: d.contacts.tlMullerPay, sub: d.contacts.tlMullerPaySub, at: formatDate("2026-08-03", locale) },
        ]
      : []),
    ...(c.id === "c-sci-bealieu"
      ? [
          { kind: "payment", label: d.contacts.tlSciStatement, sub: d.contacts.tlSciStatementSub, at: formatDate("2026-08-05", locale) },
          { kind: "document", label: d.contacts.tlSciCdd, sub: fmt(d.contacts.tlSciCddSub, { u1: CONTACTS.find((x) => x.id === "c-faber")!.name, u2: CONTACTS.find((x) => x.id === "c-faber-p")!.name }), at: formatDate("2026-02-10", locale) },
        ]
      : []),
    ...(c.id === "c-lambert"
      ? [
          { kind: "document", label: d.contacts.tlLambertPack, sub: d.contacts.tlLambertPackSub, at: formatDate("2026-06-12", locale) },
          { kind: "system", label: d.contacts.tlLambertReview, sub: d.contacts.tlLambertReviewSub, at: formatDate("2026-02-10", locale) },
        ]
      : []),
    // The record's own creation, when the base dates it: the day it carries, and its source only when it is known to be a manual entry.
    ...(c.createdAt
      ? [{ kind: "system", label: d.contacts.tlCreated, sub: c.source === "manual" ? d.contacts.tlCreatedSub : undefined, at: formatDate(c.createdAt, locale) }]
      : []),
  ];

  return (
    <div>
      <div className="mb-2">
        <Link href="/app/contacts" className="inline-flex items-center gap-0.5 text-sm font-semibold text-brand-700 hover:underline max-sm:min-h-10">
          <Icon name="chevron-left" size={16} />
          {d.contacts.backToList}
        </Link>
      </div>

      <div className="mb-6 flex flex-wrap items-center gap-4">
        <span
          className={
            "flex h-14 w-14 items-center justify-center rounded-full text-lg font-bold " +
            (c.kind === "legal" ? "bg-violet-100 text-violet-800" : "bg-brand-100 text-brand-800")
          }
        >
          {initials(c.name)}
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-2xl font-bold tracking-tight text-ink">{c.name}</h1>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm text-ink-soft">
            <ContactLink email={c.email} none={d.common.none} />
            <span aria-hidden>·</span>
            <ContactLink phone={c.phone} none={d.common.none} />
            <span aria-hidden>·</span>
            <span>{fmt(d.contacts.languageLabel, { lang: c.language.toUpperCase() })}</span>
            {c.residency === "non_resident" && <span>· {fmt(d.contacts.nonResident, { country: c.country ?? d.common.none })}</span>}
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          {c.roles.map((r) => (
            <MetaBadge key={r} meta={roleMeta[r]} />
          ))}
        </div>
        {/* The contact is corrected from its own sheet: identity and reach, bank details, note. */}
        <div className="max-sm:w-full">
          <ModifyMenu groups={contactMenu(c, d)} labels={modifyLabels(d)} />
        </div>
      </div>

      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-3">
        <div className="flex flex-col gap-5 lg:col-span-2">
          {leases.length > 0 && (
            <Panel title={d.contacts.leasesTitle}>
              <ul className="divide-y divide-sand-100">
                {leases.map((l) => (
                  <li key={l.id} className="flex items-center gap-3 py-2.5">
                    <div className="min-w-0 flex-1">
                      <Link
                        href={`/app/baux/${l.id}`}
                        className="block truncate text-sm font-semibold text-ink hover:text-brand-700 max-sm:leading-10"
                      >
                        {leaseUnitLabel(l)}
                      </Link>
                      <p className="text-xs text-ink-soft">
                        {euros(l.rentCents, locale)}
                        {d.common.perMonth} · {fmt(d.baux.since, { date: formatDate(l.startDate, locale) })}
                        {l.colocation &&
                          ` · ${fmt(d.contacts.colocWith, {
                            names: leaseTenantNames(l)
                              .filter((n) => n !== c.name)
                              .join(", "),
                          })}`}
                      </p>
                    </div>
                    <MetaBadge meta={statusMeta[l.status]} />
                  </li>
                ))}
              </ul>
            </Panel>
          )}

          {tickets.length > 0 && (
            <Panel title={d.contacts.ticketsTitle}>
              <ul className="divide-y divide-sand-100">
                {tickets.map((t) => (
                  <li key={t.id} className="flex items-center gap-3 py-2.5 text-sm">
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-ink">
                        {t.ref} · {t.title}
                      </p>
                      <p className="text-xs text-ink-soft">{t.unitLabel}</p>
                    </div>
                    {t.amountCents && <span className="tabular-nums text-ink">{euros(t.amountCents, locale)}</span>}
                  </li>
                ))}
              </ul>
            </Panel>
          )}

          {isOwner && (
            <Panel title={d.contacts.mandateTitle}>
              {/* What is written on the record, or nothing: no mandate is announced that no record attests. */}
              {c.notes && <p className="mb-3 text-sm leading-relaxed text-ink">{c.notes}</p>}
              {(statementsHref || taxPackHref) && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {statementsHref && (
                    <Link
                      href={statementsHref}
                      className="rounded-xl border border-sand-200 bg-white px-3 py-1.5 text-xs font-semibold text-ink-soft transition hover:border-brand-300 hover:text-brand-700 max-sm:inline-flex max-sm:min-h-10 max-sm:items-center"
                    >
                      {d.contacts.mandateStatements}
                    </Link>
                  )}
                  {taxPackHref && (
                    <Link
                      href={taxPackHref}
                      className="rounded-xl border border-sand-200 bg-white px-3 py-1.5 text-xs font-semibold text-ink-soft transition hover:border-brand-300 hover:text-brand-700 max-sm:inline-flex max-sm:min-h-10 max-sm:items-center"
                    >
                      {d.contacts.mandateTaxPack}
                    </Link>
                  )}
                </div>
              )}
            </Panel>
          )}

          {/* A note written on the record shows on the record, whoever the contact is. */}
          {!isOwner && c.notes && (
            <Panel title={d.shell.fieldNote}>
              <p className="whitespace-pre-line text-sm leading-relaxed text-ink">{c.notes}</p>
            </Panel>
          )}

          {timeline.length > 0 && (
            <Panel title={d.contacts.activityTitle}>
              <Timeline entries={timeline} />
            </Panel>
          )}
        </div>

        <div className="flex flex-col gap-5">
          <Panel title={d.contacts.bankTitle}>
            {c.iban || payerIbans.length > 0 ? (
              <ul className="space-y-2 text-sm">
                {c.iban && (
                  <li className="flex flex-wrap justify-between gap-x-3 gap-y-0.5">
                    <span className="text-ink-soft">{d.location.payerIban}</span>
                    <span className="font-semibold tabular-nums text-ink">{c.iban}</span>
                  </li>
                )}
                {payerIbans.map((iban) => (
                  <li key={iban} className="flex flex-wrap justify-between gap-x-3 gap-y-0.5">
                    <span className="text-ink-soft">
                      {d.location.payerIban} · {d.contacts.bankCaptured}
                    </span>
                    <span className="font-semibold tabular-nums text-ink">{iban}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-ink-soft">{d.contacts.bankNone}</p>
            )}
            <LegalNote>{d.contacts.bankLegal}</LegalNote>
          </Panel>

          {(c.amlTier || c.riskBand) && (
            <Panel title={d.contacts.amlTitle}>
              <ul className="space-y-2.5 text-sm">
                {c.amlTier && (
                  <li className="flex items-center justify-between gap-3">
                    <span className="text-ink-soft">{d.contacts.amlTier}</span>
                    <MetaBadge meta={amlMeta[c.amlTier]} />
                  </li>
                )}
                {c.riskBand && (
                  <li className="flex items-center justify-between gap-3">
                    <span className="text-ink-soft">{d.contacts.amlClass}</span>
                    <MetaBadge meta={riskMeta[c.riskBand]} />
                  </li>
                )}
                {c.kind === "legal" && (
                  <li className="flex items-center justify-between gap-3">
                    <span className="text-ink-soft">{d.contacts.amlUbo}</span>
                    <Badge className="bg-emerald-100 text-emerald-800">{d.contacts.amlUboOk}</Badge>
                  </li>
                )}
              </ul>
              <Link href="/app/aml" className="mt-3 block text-sm font-semibold text-brand-700 hover:underline max-sm:inline-flex max-sm:min-h-10 max-sm:items-center">
                {d.contacts.amlLink}
              </Link>
            </Panel>
          )}

          <Panel title={d.contacts.retentionTitle}>
            <p className="text-xs leading-relaxed text-ink-soft">{d.contacts.retentionBody}</p>
          </Panel>
        </div>
      </div>
    </div>
  );
}
