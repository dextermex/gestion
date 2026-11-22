import { PageHeader } from "@/components/pro/ui";
import { Segments } from "@/components/gestion/Hero";
import ToolGrid, { type ToolGroup } from "@/components/gestion/ToolGrid";
import { getDemo } from "@/lib/demo";
import { getI18n } from "@/lib/i18n";
import { plural } from "@/lib/i18n/config";

/**
 * Rapports: every report the books can already give, by family, each
 * opening the screen that produces it from the workspace's own rows. A
 * report that is not built yet is listed as such and leads nowhere; none
 * is promised by a card that opens an empty page. The tax pack is one of
 * them: it is a link only where the account has a prepared exercise.
 */
const GROUPS = ["financier", "loyers", "charges", "biens"] as const;
type Group = (typeof GROUPS)[number];

export default async function RapportsPage({ searchParams }: { searchParams: Promise<{ famille?: string }> }) {
  const params = await searchParams;
  const { locale, d } = await getI18n();
  const { FISCAL_YEARS } = await getDemo();
  const r = d.reports;
  const count = (n: number) => plural(locale, n, r.countOne, r.countMany);

  const all: Array<{ key: Group; title: string; items: ToolGroup["items"] }> = [
    {
      key: "financier",
      title: r.gFin,
      items: [
        { key: "yearResult", icon: "analytics", href: "/app/finance?vue=resultat", ...r.items.yearResult },
        { key: "cashflow", icon: "trending-up", href: "/app/finance", ...r.items.cashflow },
        { key: "bank", icon: "bank", href: "/app/banque", ...r.items.bank },
        { key: "taxSummary", icon: "percent", href: "/app/fiscalite", ...r.items.taxSummary },
        { key: "taxPack", icon: "contract", href: FISCAL_YEARS.length > 0 ? "/app/fiscalite?vue=detail" : undefined, ...r.items.taxPack },
        { key: "statement", icon: "documents", ...r.items.statement },
      ],
    },
    {
      key: "loyers",
      title: r.gRent,
      items: [
        { key: "rentMonth", icon: "euro", href: "/app/loyers", ...r.items.rentMonth },
        { key: "rentLate", icon: "alert", href: "/app/loyers?vue=impayes", ...r.items.rentLate },
        { key: "rentRoll", icon: "key", href: "/app/baux", ...r.items.rentRoll },
        { key: "rentReview", icon: "percent", href: "/app/indexation", ...r.items.rentReview },
        { key: "tenantLedger", icon: "contacts", ...r.items.tenantLedger },
      ],
    },
    {
      key: "charges",
      title: r.gCosts,
      items: [
        { key: "costsByCategory", icon: "gauge", href: "/app/finance?vue=charges", ...r.items.costsByCategory },
        { key: "toPay", icon: "clock", href: "/app/finance", ...r.items.toPay },
        { key: "chargeStatements", icon: "documents", href: "/app/charges", ...r.items.chargeStatements },
        { key: "mileage", icon: "pin", ...r.items.mileage },
      ],
    },
    {
      key: "biens",
      title: r.gPortfolio,
      items: [
        { key: "vacancy", icon: "properties", href: "/app/biens?occupation=vacants", ...r.items.vacancy },
        { key: "deposits", icon: "lock", href: "/app/garanties", ...r.items.deposits },
        { key: "insurance", icon: "shield-check", href: "/app/assurances", ...r.items.insurance },
        { key: "deadlines", icon: "calendar", href: "/app/conformite", ...r.items.deadlines },
      ],
    },
  ];
  const family: Group | null = GROUPS.includes(params.famille as Group) ? (params.famille as Group) : null;
  const shown = family ? all.filter((g) => g.key === family) : all;
  const total = all.reduce((a, g) => a + g.items.length, 0);

  return (
    <div>
      <PageHeader title={r.title} subtitle={r.lead} />
      <div className="mb-8">
        <Segments
          label={r.tabsAria}
          items={[
            { href: "/app/rapports", label: r.all, count: total, current: family === null },
            ...all.map((g) => ({ href: `/app/rapports?famille=${g.key}`, label: g.title, count: g.items.length, current: family === g.key })),
          ]}
        />
      </div>
      <ToolGrid groups={shown.map((g) => ({ key: g.key, title: g.title, countLabel: count(g.items.length), items: g.items }))} soonLabel={r.soon} externalLabel="" />
    </div>
  );
}
