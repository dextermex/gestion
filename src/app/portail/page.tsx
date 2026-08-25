import { getDemo } from "@/lib/demo";
import { getI18n } from "@/lib/i18n";
import { depositFormLabels, rentStatusMeta, ticketStatusMeta } from "@/lib/types";
import { leaseRF } from "@/domain/banking/rf";
import { PortalApp, type PortalBundle, type PortalOrg } from "@/components/portal/PortalApp";

/**
 * Tenant portal (outside the manager shell). The server resolves the active
 * demo dataset + locale into plain serialisable bundles, one per lease the
 * portal can be opened for; everything interactive (invitation, onboarding
 * wizard, requests) is client-side with localStorage persistence.
 */
export default async function PortailPage() {
  const { locale, d } = await getI18n();
  const demo = await getDemo();
  const rentMeta = rentStatusMeta(d);
  const ticketMeta = ticketStatusMeta(d);
  const depositForms = depositFormLabels(d);

  const bundles: PortalBundle[] = demo.LEASES.filter(
    (l) => l.status === "active" || l.status === "notice",
  ).map((l) => {
    const unit = demo.unitById(l.unitId);
    const property = demo.propertyById(unit.propertyId);
    const documents = demo.DOCUMENTS.filter((doc) => doc.relatedLabel === unit.label).map((doc) => ({
      name: doc.name,
      sizeKb: doc.sizeKb,
      createdAt: doc.createdAt,
    }));
    // The signed lease itself is always available, even when the demo document
    // vault holds nothing else for this unit. ("Bail" stays French by convention.)
    if (!documents.some((doc) => doc.name.startsWith("Bail"))) {
      documents.unshift({ name: `Bail ${unit.label} (AES).pdf`, sizeKb: 720, createdAt: l.startDate });
    }
    return {
      leaseId: l.id,
      tenantName: demo.leaseTenantNames(l)[0] ?? "",
      unitLabel: unit.label,
      propertyName: property.name,
      address: property.address,
      rentCents: l.rentCents,
      chargesCents: l.chargesCents,
      chargesRegimeLabel: l.chargesRegime === "advances" ? d.baux.regimeAdvances : d.baux.regimeForfait,
      depositMonths: l.depositMonths,
      depositFormLabel: depositForms[l.depositForm],
      startDate: l.startDate,
      rfRef: leaseRF(1, l.seq),
      periods: demo.RENT_PERIODS.filter((rp) => rp.leaseId === l.id).map((rp) => ({
        period: rp.period,
        dueDate: rp.dueDate,
        totalCents: rp.totalCents,
        status: rp.status,
        statusLabel: rentMeta[rp.status].label,
        statusColor: rentMeta[rp.status].color,
      })),
      requests: demo.TICKETS.filter(
        (t) => t.leaseId === l.id && (t.source === "tenant" || t.source === "edl_defect"),
      ).map((t) => ({
        id: t.id,
        ref: t.ref,
        title: t.title,
        createdAt: t.createdAt,
        statusLabel: ticketMeta[t.status].label,
        statusColor: ticketMeta[t.status].color,
      })),
      documents,
    };
  });

  const org: PortalOrg = {
    name: demo.ORG.name,
    managerName: demo.ORG.managerName,
    email: demo.ORG.managerEmail,
  };

  return (
    <PortalApp
      locale={locale}
      strings={d.portal}
      demoLabel={d.common.demo}
      bundles={bundles}
      org={org}
      defaultLeaseId="l-3b"
    />
  );
}
