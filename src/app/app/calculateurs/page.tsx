import { PageHeader } from "@/components/pro/ui";
import { Segments } from "@/components/gestion/Hero";
import ToolGrid, { type ToolGroup } from "@/components/gestion/ToolGrid";
import { MORADA_URL } from "@/lib/constants";
import { getI18n } from "@/lib/i18n";
import { plural } from "@/lib/i18n/config";

/**
 * Calculateurs: the sums a landlord does before buying, letting and
 * declaring, in one place and by family. The financing simulator runs in
 * the app; the others are Morada's public calculators and open on the
 * public site, said as such on each card. Nothing here is computed on this
 * page: each calculator carries its own figures and sources.
 */
const GROUPS = ["achat", "loyers", "fiscalite"] as const;
type Group = (typeof GROUPS)[number];

export default async function CalculateursPage({ searchParams }: { searchParams: Promise<{ famille?: string }> }) {
  const params = await searchParams;
  const { locale, d } = await getI18n();
  const c = d.calculators;
  const site = (slug: string) => `${MORADA_URL}/${locale}/calculators/${slug}`;
  const count = (n: number) => plural(locale, n, c.countOne, c.countMany);

  const all: Array<{ key: Group; title: string; items: ToolGroup["items"] }> = [
    {
      key: "achat",
      title: c.gInvest,
      items: [
        { key: "simulator", icon: "bank", href: "/app/financement/simulateur", ...c.items.simulator },
        { key: "yield", icon: "percent", href: site("rental-yield"), external: true, ...c.items.rentalYield },
        { key: "cashflow", icon: "trending-up", href: site("rental-cash-flow"), external: true, ...c.items.rentalCashFlow },
        { key: "purchase", icon: "properties", href: site("purchase-costs"), external: true, ...c.items.purchaseCosts },
        { key: "mortgage", icon: "euro", href: site("buy-to-let-mortgage"), external: true, ...c.items.mortgage },
      ],
    },
    {
      key: "loyers",
      title: c.gRent,
      items: [
        { key: "prorata", icon: "calendar", href: site("pro-rata-rent"), external: true, ...c.items.proRata },
        { key: "review", icon: "analytics", href: site("rent-review"), external: true, ...c.items.rentReview },
        { key: "affordability", icon: "user", href: site("rent-affordability"), external: true, ...c.items.affordability },
      ],
    },
    {
      key: "fiscalite",
      title: c.gTax,
      items: [{ key: "tax", icon: "contract", href: site("rental-income-tax"), external: true, ...c.items.incomeTax }],
    },
  ];
  const family: Group | null = GROUPS.includes(params.famille as Group) ? (params.famille as Group) : null;
  const shown = family ? all.filter((g) => g.key === family) : all;
  const total = all.reduce((a, g) => a + g.items.length, 0);

  return (
    <div>
      <PageHeader title={c.title} subtitle={c.lead} />
      <div className="mb-8">
        <Segments
          label={c.tabsAria}
          items={[
            { href: "/app/calculateurs", label: c.all, count: total, current: family === null },
            ...all.map((g) => ({ href: `/app/calculateurs?famille=${g.key}`, label: g.title, count: g.items.length, current: family === g.key })),
          ]}
        />
      </div>
      <ToolGrid groups={shown.map((g) => ({ key: g.key, title: g.title, countLabel: count(g.items.length), items: g.items }))} soonLabel={c.soon} externalLabel={c.external} />
    </div>
  );
}
