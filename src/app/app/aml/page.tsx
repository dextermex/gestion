import { Badge, Card, PageHeader } from "@/components/pro/ui";
import { LegalNote, MetaBadge, Panel } from "@/components/gestion/bits";
import { CONTACTS, TODAY } from "@/lib/demo/data";
import { amlTierMeta, initials, riskBandMeta } from "@/lib/types";
import { getI18n } from "@/lib/i18n";
import { fmt } from "@/lib/i18n/config";
import { resolveCddTier, resolveUbo } from "@/domain/aml/engine";
import { cents } from "@/domain/money";

export default async function AmlPage() {
  const { d } = await getI18n();
  const amlMeta = amlTierMeta(d);
  const riskMeta = riskBandMeta(d);

  // Live trigger demo: an ordinary tenancy stays light; the SCI goes full CDD.
  const tenantTier = resolveCddTier({
    relationship: "tenancy",
    monthlyRent: cents(1850),
    counterpartyIsLegalEntity: false,
    cashMovements: [],
    onDate: TODAY,
  });
  const sciInput = {
    relationship: "letting_mandate" as const,
    monthlyRent: null,
    counterpartyIsLegalEntity: true,
    cashMovements: [],
    onDate: TODAY,
  };
  const sciTier = resolveCddTier(sciInput);
  // Localized trigger bullets, derived from the input conditions the engine saw.
  const sciTriggers = sciInput.counterpartyIsLegalEntity ? [d.aml.trigLegalEntity] : [];

  const sciUbo = resolveUbo(
    [
      {
        name: "SCI Beaulieu",
        sharePct: 100,
        isNaturalPerson: false,
        children: [
          { name: "Marie Faber", sharePct: 60, isNaturalPerson: true },
          { name: "Pierre Faber", sharePct: 40, isNaturalPerson: true },
        ],
      },
    ],
    TODAY,
  );

  const parties = CONTACTS.filter((c) => c.amlTier);

  return (
    <div>
      <PageHeader title={d.aml.title} subtitle={d.aml.subtitle} />

      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-2">
        <Panel title={d.aml.triggersTitle}>
          <div className="space-y-3">
            <div className="rounded-xl border border-sand-200 p-4">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-semibold text-ink">{d.aml.caseTenant}</p>
                <MetaBadge meta={amlMeta[tenantTier.tier]} />
              </div>
              <p className="mt-1 text-xs text-ink-soft">{d.aml.caseTenantBody}</p>
            </div>
            <div className="rounded-xl border border-violet-200 bg-violet-50/40 p-4">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-semibold text-ink">{d.aml.caseSci}</p>
                <MetaBadge meta={amlMeta[sciTier.tier]} />
              </div>
              <ul className="mt-1.5 space-y-1">
                {sciTriggers.map((t) => (
                  <li key={t} className="text-xs text-ink-soft">
                    • {t}
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <LegalNote>{d.aml.triggersLegal}</LegalNote>
        </Panel>

        <Panel title={d.aml.uboTitle}>
          <div className="rounded-xl border border-sand-200 p-4">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-violet-100 text-sm font-bold text-violet-800">
                SB
              </span>
              <div>
                <p className="text-sm font-semibold text-ink">SCI Beaulieu</p>
                <p className="text-xs text-ink-soft">{d.aml.uboMeta}</p>
              </div>
              <Badge className="ml-auto bg-emerald-100 text-emerald-800">{d.aml.uboComplete}</Badge>
            </div>
            <div className="mt-3 space-y-2 border-l-2 border-sand-200 pl-4">
              {sciUbo.ubos.map((u) => (
                <div key={u.name} className="flex items-center gap-3">
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-100 text-xs font-bold text-brand-800">
                    {initials(u.name)}
                  </span>
                  <p className="min-w-0 flex-1 text-sm text-ink">{u.name}</p>
                  <Badge className="bg-brand-100 text-brand-800">
                    {fmt(d.aml.uboBadge, { pct: u.effectivePct })}
                  </Badge>
                </div>
              ))}
            </div>
            <p className="mt-3 text-[11px] text-ink-soft">{fmt(d.aml.uboFoot, { pct: sciUbo.thresholdPct })}</p>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3 text-center">
            <div className="rounded-xl bg-sand-50 p-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-soft">{d.aml.pepTitle}</p>
              <Badge className="mt-1.5 bg-emerald-100 text-emerald-800">{d.aml.noHit}</Badge>
            </div>
            <div className="rounded-xl bg-sand-50 p-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-soft">
                {d.aml.sanctionsTitle}
              </p>
              <Badge className="mt-1.5 bg-emerald-100 text-emerald-800">{d.aml.noHit}</Badge>
            </div>
          </div>
        </Panel>
      </div>

      <Panel title={d.aml.filesTitle} className="mt-5">
        <ul className="divide-y divide-sand-100">
          {parties.map((c) => (
            <li key={c.id} className="flex items-center gap-3 py-3">
              <span
                className={
                  "flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold " +
                  (c.kind === "legal" ? "bg-violet-100 text-violet-800" : "bg-brand-100 text-brand-800")
                }
              >
                {initials(c.name)}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-ink">{c.name}</p>
                <p className="truncate text-xs text-ink-soft">
                  {c.kind === "legal" ? d.contacts.personLegal : d.contacts.personNatural}
                  {c.residency === "non_resident" &&
                    ` · ${fmt(d.contacts.nonResidentEdd, { country: c.country ?? "—" })}`}
                </p>
              </div>
              {c.riskBand && <MetaBadge meta={riskMeta[c.riskBand]} />}
              <MetaBadge meta={amlMeta[c.amlTier!]} />
              <span className="text-[11px] tabular-nums text-ink-soft">
                {fmt(d.contacts.reviewMonths, {
                  n: c.riskBand === "high" ? 12 : c.riskBand === "medium" ? 24 : 36,
                })}
              </span>
            </li>
          ))}
        </ul>
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Card className="border-dashed bg-sand-50/50 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-soft">{d.aml.crfTitle}</p>
            <p className="mt-1 text-xs leading-relaxed text-ink-soft">{d.aml.crfBody}</p>
          </Card>
          <Card className="border-dashed bg-sand-50/50 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-soft">{d.aml.retentionTitle}</p>
            <p className="mt-1 text-xs leading-relaxed text-ink-soft">{d.aml.retentionBody}</p>
          </Card>
          <Card className="border-dashed bg-sand-50/50 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-soft">{d.aml.productTitle}</p>
            <p className="mt-1 text-xs leading-relaxed text-ink-soft">{d.aml.productBody}</p>
          </Card>
        </div>
      </Panel>
    </div>
  );
}
