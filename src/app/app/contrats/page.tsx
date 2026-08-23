import Link from "next/link";
import { Badge, Card, PageHeader } from "@/components/pro/ui";
import { LegalNote, MetaBadge, Panel } from "@/components/gestion/bits";
import { LEASES, TODAY, leaseTenantNames, leaseUnitLabel } from "@/lib/demo/data";
import { euros, formatDate, leaseStatusMeta, leaseTypeMeta } from "@/lib/types";
import { getI18n } from "@/lib/i18n";
import { fmt } from "@/lib/i18n/config";
import { leaseIssueText } from "@/lib/i18n/engine";
import { RESIDENTIAL_MANDATORY_MENTIONS, validateLeaseDraft } from "@/domain/lease/rules";
import { getParamValue } from "@/domain/legal/params";
import { cents } from "@/domain/money";

export default async function ContratsPage() {
  const { locale, d } = await getI18n();
  const statusMeta = leaseStatusMeta(d);
  const typeMeta = leaseTypeMeta(d);

  const mentionLabels: Record<(typeof RESIDENTIAL_MANDATORY_MENTIONS)[number], string> = {
    parties_identity: d.contrats.mentionParties,
    property_designation: d.contrats.mentionDesignation,
    lease_start_date: d.contrats.mentionStart,
    duration_or_indefinite: d.contrats.mentionDuration,
    rent_amount: d.contrats.mentionRent,
    charges_regime: d.contrats.mentionCharges,
    deposit_terms: d.contrats.mentionDeposit,
    capital_investi_declaration: d.contrats.mentionCapital,
  };

  // A deliberately non-compliant draft: the generator refuses it, live.
  const badDraftMonths = 3;
  const badDraft = validateLeaseDraft(
    {
      type: "residential",
      startDate: "2026-10-01",
      endDate: null,
      monthlyRent: cents(2400),
      monthlyCharges: cents(300),
      depositMonths: badDraftMonths,
      depositForm: "cash",
      mentions: {
        parties_identity: "ok",
        property_designation: "ok",
        lease_start_date: "ok",
        duration_or_indefinite: "ok",
        rent_amount: "ok",
        charges_regime: "ok",
        deposit_terms: "ok",
        // capital_investi_declaration missing
      },
      hasCpiEscalationClause: true,
      furnished: false,
      colocation: false,
    },
    TODAY,
  );
  const issueVars = {
    months: badDraftMonths,
    max: getParamValue("residential.deposit_max_months", TODAY),
    date: "—",
  };

  return (
    <div>
      <PageHeader title={d.contrats.title} subtitle={d.contrats.subtitle} />

      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-2">
        <Panel title={d.contrats.registryTitle}>
          <ul className="divide-y divide-sand-100">
            {LEASES.map((l) => (
              <li key={l.id} className="flex items-center gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/app/baux/${l.id}`}
                    className="block truncate text-sm font-semibold text-ink hover:text-brand-700"
                  >
                    {leaseUnitLabel(l)}
                  </Link>
                  <p className="truncate text-xs text-ink-soft">
                    {leaseTenantNames(l).join(", ")} · {euros(l.rentCents, locale)}
                    {d.common.perMonth} ·{" "}
                    {l.status === "draft"
                      ? d.contrats.draft
                      : fmt(d.contrats.signedAes, { date: formatDate(l.startDate, locale) })}
                  </p>
                </div>
                <MetaBadge meta={typeMeta[l.type]} />
                <MetaBadge meta={statusMeta[l.status]} />
              </li>
            ))}
          </ul>
          <LegalNote>{d.contrats.registryLegal}</LegalNote>
        </Panel>

        <Panel title={d.contrats.gateTitle}>
          <p className="mb-3 text-sm text-ink-soft">{d.contrats.gateIntro}</p>
          <ul className="space-y-2">
            {badDraft.map((i) => (
              <li key={i.code} className="rounded-xl border border-red-200 bg-red-50 px-4 py-3">
                <p className="text-sm font-semibold text-red-700">{leaseIssueText(d, i.code, issueVars, i.message)}</p>
                <p className="mt-0.5 text-xs text-red-700">{i.legalBasis}</p>
              </li>
            ))}
          </ul>
          <div className="mt-4">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-soft">
              {d.contrats.mentionsTitle}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {RESIDENTIAL_MANDATORY_MENTIONS.map((m) => (
                <Badge key={m} className="bg-sand-100 text-ink-soft">
                  {mentionLabels[m]}
                </Badge>
              ))}
            </div>
          </div>
        </Panel>
      </div>

      <Card className="mt-5 p-5">
        <h2 className="font-display text-lg font-bold text-ink">{d.contrats.enforcedTitle}</h2>
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {d.contrats.enforced.map(([title, body]) => (
            <div key={title} className="rounded-2xl border border-sand-200 p-4">
              <p className="text-sm font-bold text-ink">{title}</p>
              <p className="mt-1 text-xs leading-relaxed text-ink-soft">{body}</p>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
