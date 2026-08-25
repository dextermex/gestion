import { PageHeader } from "@/components/pro/ui";
import TenantRequests, { type RequestKind } from "@/components/gestion/TenantRequests";
import { getDemo } from "@/lib/demo";
import { tenantPersona } from "@/lib/demo/tenant";
import { formatDate, ticketStatusMeta } from "@/lib/types";
import { getI18n } from "@/lib/i18n";

export default async function TenantRequestsPage({
  searchParams,
}: {
  searchParams: Promise<{ nouvelle?: string }>;
}) {
  const params = await searchParams;
  const { locale, d } = await getI18n();
  const demo = await getDemo();
  const { lease } = tenantPersona(demo);
  const ticketMeta = ticketStatusMeta(d);

  const initial: RequestKind | undefined =
    params.nouvelle === "technique" || params.nouvelle === "administrative"
      ? params.nouvelle
      : undefined;

  const tickets = demo.TICKETS.filter((t) => t.leaseId === lease.id).map((t) => ({
    id: t.id,
    ref: t.ref,
    title: t.title,
    statusLabel: ticketMeta[t.status].label,
    statusColor: ticketMeta[t.status].color,
    dateLabel: formatDate(t.createdAt, locale),
  }));

  return (
    <div>
      <PageHeader title={d.tenant.reqTitle} subtitle={d.tenant.reqSub} />
      <TenantRequests d={d} initial={initial} tickets={tickets} />
    </div>
  );
}
