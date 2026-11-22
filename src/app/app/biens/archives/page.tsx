import Link from "next/link";
import { EmptyState, PageHeader } from "@/components/pro/ui";
import ArchivedProperties from "@/components/gestion/ArchivedProperties";
import { getDemo } from "@/lib/demo";
import { getI18n } from "@/lib/i18n";
import { fmt, plural } from "@/lib/i18n/config";
import { formatDate } from "@/lib/types";

/**
 * The properties taken off the screens. Archiving deletes nothing: the
 * property, its lots, its tenancies and their ledgers stay in the base, and
 * this page is where one is brought back.
 */
export default async function ArchivedPropertiesPage() {
  const { locale, d } = await getI18n();
  const demo = await getDemo();
  const back = (
    <Link href="/app/biens" className="text-sm font-semibold text-brand-700 hover:underline max-sm:inline-flex max-sm:min-h-10 max-sm:items-center">
      {d.biens.backToBiens}
    </Link>
  );
  const rows = demo.ARCHIVED_PROPERTIES.map((p) => ({
    id: p.id,
    name: p.name,
    address: p.address,
    meta: [fmt(d.biens.archivedOn, { date: formatDate(p.archivedOn, locale) }), plural(locale, p.unitsCount, d.biens.lotOne, d.biens.lotMany)].join(" · "),
  }));

  return (
    <div>
      <PageHeader title={d.biens.archivedTitle} subtitle={d.biens.archivedSubtitle} actions={back} />
      {rows.length === 0 ? (
        <EmptyState icon="properties" title={d.biens.archivedEmpty} action={back} />
      ) : (
        <ArchivedProperties rows={rows} labels={{ restore: d.biens.restore, restoreFailed: d.biens.restoreFailed }} />
      )}
    </div>
  );
}
