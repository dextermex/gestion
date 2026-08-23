import Link from "next/link";
import { Badge, Card, PageHeader } from "@/components/pro/ui";
import { LEASES, PROPERTIES, UNITS } from "@/lib/demo/data";
import { euros } from "@/lib/types";
import { getI18n } from "@/lib/i18n";
import { fmt } from "@/lib/i18n/config";

export default async function BiensPage() {
  const { locale, d } = await getI18n();
  return (
    <div>
      <PageHeader title={d.biens.title} subtitle={d.biens.subtitle} />

      <div className="stagger-rise grid grid-cols-1 gap-5 sm:grid-cols-2">
        {PROPERTIES.map((p) => {
          const units = UNITS.filter((u) => u.propertyId === p.id);
          const lettable = units.filter((u) => u.kind !== "parking");
          const occupied = lettable.filter((u) =>
            LEASES.some((l) => l.unitId === u.id && (l.status === "active" || l.status === "notice")),
          );
          const monthlyRent = LEASES.filter(
            (l) => (l.status === "active" || l.status === "notice") && units.some((u) => u.id === l.unitId),
          ).reduce((a, l) => a + l.rentCents, 0);
          const vacant = lettable.length - occupied.length;

          return (
            <Link key={p.id} href={`/app/biens/${p.id}`} className="group">
              <Card className="h-full p-5 transition-all duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:-translate-y-0.5 group-hover:border-brand-100 group-hover:shadow-md">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="truncate font-display text-lg font-bold text-ink group-hover:text-brand-700">
                      {p.name}
                    </h2>
                    <p className="truncate text-xs text-ink-soft">{p.address}</p>
                  </div>
                  <span
                    className={
                      "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-xs font-bold " +
                      (p.energyClass.startsWith("A")
                        ? "bg-emerald-100 text-emerald-800"
                        : p.energyClass === "B" || p.energyClass === "C"
                          ? "bg-amber-100 text-amber-800"
                          : "bg-red-100 text-red-700")
                    }
                    role="img"
                    aria-label={fmt(d.biens.energyAria, { cls: p.energyClass })}
                    title={fmt(d.biens.energyAria, { cls: p.energyClass })}
                  >
                    {p.energyClass}
                  </span>
                </div>

                <div className="mt-4 grid grid-cols-3 gap-3">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-soft">{d.biens.lots}</p>
                    <p className="mt-0.5 font-display text-lg font-bold tabular-nums text-ink">{lettable.length}</p>
                  </div>
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-soft">{d.biens.occupied}</p>
                    <p className="mt-0.5 font-display text-lg font-bold tabular-nums text-ink">
                      {occupied.length}/{lettable.length}
                    </p>
                  </div>
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-soft">
                      {d.biens.rentPerMonth}
                    </p>
                    <p className="mt-0.5 font-display text-lg font-bold tabular-nums text-ink">
                      {euros(monthlyRent, locale)}
                    </p>
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-1.5">
                  {p.isCopropriete && <Badge className="bg-sand-100 text-ink-soft">{d.biens.copro}</Badge>}
                  {vacant > 0 && (
                    <Badge className="bg-amber-100 text-amber-800">{fmt(d.biens.vacant, { n: vacant })}</Badge>
                  )}
                  {!p.smokeDetectorsConfirmed && (
                    <Badge className="bg-red-100 text-red-700">{d.biens.smokeMissing}</Badge>
                  )}
                </div>
                <p className="mt-3 truncate text-[11px] text-ink-soft">{p.ownershipNote}</p>
              </Card>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
