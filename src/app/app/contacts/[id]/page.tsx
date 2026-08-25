import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/pro/ui";
import { LegalNote, MetaBadge, Panel, Timeline } from "@/components/gestion/bits";
import { getDemo } from "@/lib/demo";
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

// No generateStaticParams: the page reads the locale cookie, so it must be
// request-rendered — a build-time prerender would bake one language in.

export default async function ContactDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { locale, d } = await getI18n();
  const { CONTACTS, LEASES, TICKETS, leaseTenantNames, leaseUnitLabel } = await getDemo();
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
    { kind: "system", label: d.contacts.tlCreated, sub: d.contacts.tlCreatedSub, at: "2025" },
  ];

  return (
    <div>
      <div className="mb-2">
        <Link href="/app/contacts" className="text-sm font-semibold text-brand-700 hover:underline">
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
          <p className="mt-0.5 text-sm text-ink-soft">
            {c.email ?? "—"} · {c.phone ?? "—"} · {fmt(d.contacts.languageLabel, { lang: c.language.toUpperCase() })}
            {c.residency === "non_resident" && ` · ${fmt(d.contacts.nonResident, { country: c.country ?? "—" })}`}
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          {c.roles.map((r) => (
            <MetaBadge key={r} meta={roleMeta[r]} />
          ))}
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
                        className="block truncate text-sm font-semibold text-ink hover:text-brand-700"
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
              <p className="mt-3 text-xs text-ink-soft">{d.contacts.ticketsFoot}</p>
            </Panel>
          )}

          {isOwner && (
            <Panel title={d.contacts.mandateTitle}>
              <p className="text-sm leading-relaxed text-ink">{c.notes ?? d.contacts.mandateDefault}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Link
                  href="/app/finance"
                  className="rounded-xl border border-sand-200 bg-white px-3 py-1.5 text-xs font-semibold text-ink-soft transition hover:border-brand-300 hover:text-brand-700"
                >
                  {d.contacts.mandateStatements}
                </Link>
                <Link
                  href="/app/fiscalite"
                  className="rounded-xl border border-sand-200 bg-white px-3 py-1.5 text-xs font-semibold text-ink-soft transition hover:border-brand-300 hover:text-brand-700"
                >
                  {d.contacts.mandateTaxPack}
                </Link>
              </div>
            </Panel>
          )}

          <Panel title={d.contacts.activityTitle}>
            <Timeline entries={timeline} />
          </Panel>
        </div>

        <div className="flex flex-col gap-5">
          <Panel title={d.contacts.bankTitle}>
            {leases.length > 0 || c.iban ? (
              <ul className="space-y-2 text-sm">
                <li className="flex justify-between gap-3">
                  <span className="text-ink-soft">IBAN</span>
                  <span className="font-semibold tabular-nums text-ink">{c.iban ?? d.contacts.bankCaptured}</span>
                </li>
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
              <Link href="/app/aml" className="mt-3 block text-sm font-semibold text-brand-700 hover:underline">
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
