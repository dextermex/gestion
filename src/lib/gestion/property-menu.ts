import "server-only";
import type { DemoData } from "@/lib/demo";
import type { PropertyCard } from "@/lib/gestion/portfolio";
import type { EditTopic, MenuEntry, MenuGroup } from "@/lib/gestion/editors";
import type { Dict } from "@/lib/i18n";
import type { Locale } from "@/lib/i18n/config";
import { euros } from "@/lib/types";
import { computeCapitalInvesti, proposeResidentialAdjustment } from "@/domain/indexation/engine";

/**
 * What "Modifier" offers on one property.
 *
 * The menu is built here rather than in the page because it needs the row and
 * the language at the same time, and because the shape of it is a product
 * decision worth reading in one place: the building, then the tenancy running
 * in it, then the paperwork. A vacant property has no second group — it gets
 * the one action that matters instead.
 *
 * Each entry carries the current values, so an editor opens already filled in
 * and a save is an edit rather than a re-entry.
 */

const cents = (n: number): string => (n / 100).toFixed(2).replace(".", ",");

export function propertyMenu(
  card: PropertyCard,
  demo: DemoData,
  d: Dict,
  locale: Locale,
): { groups: MenuGroup[]; hasLease: boolean } {
  const p = card.property;
  const single = card.single;
  const live = card.lots.find((l) => l.lease) ?? null;
  const lease = live?.lease ?? null;
  const tenant = lease ? demo.CONTACTS.find((c) => c.id === lease.tenantContactIds[0]) ?? null : null;

  /* ------------------------------- the property ------------------------------ */

  const info: EditTopic = {
    id: "info",
    title: d.modify.propertyInfo,
    endpoint: `/api/biens/${p.id}`,
    method: "PATCH",
    fields: [
      { kind: "text", name: "name", label: d.biens.wizNameLabel, value: p.name, required: true, maxLength: 120, span: 2 },
      { kind: "text", name: "street", label: d.biens.wizStreet, value: addressPart(p.address, "street"), required: true, maxLength: 160, span: 2 },
      { kind: "text", name: "number", label: d.biens.wizNumber, value: addressPart(p.address, "number"), maxLength: 10 },
      { kind: "text", name: "postal", label: d.biens.wizPostal, value: addressPart(p.address, "postal"), maxLength: 10 },
      { kind: "text", name: "city", label: d.biens.wizCity, value: p.commune, required: true, maxLength: 80 },
      {
        kind: "select",
        name: "country",
        label: d.biens.wizCountry,
        value: "LU",
        options: [
          { value: "LU", label: "Luxembourg" },
          { value: "FR", label: "France" },
          { value: "BE", label: "Belgique" },
          { value: "DE", label: "Deutschland" },
        ],
      },
    ],
  };

  const characteristics: MenuEntry = single
    ? {
        id: "characteristics",
        label: d.modify.characteristics,
        topic: {
          id: "characteristics",
          title: d.modify.characteristics,
          endpoint: `/api/lots/${single.unit.id}`,
          method: "PATCH",
          fields: [
            { kind: "text", name: "label", label: d.biens.wizUnitLabel, value: single.unit.label, required: true, maxLength: 60, span: 2 },
            { kind: "number", name: "areaSqm", label: d.biens.wizSurface, value: single.unit.areaSqm ? String(single.unit.areaSqm) : "" },
            { kind: "text", name: "floor", label: d.biens.wizFloor, value: single.unit.floor === "—" ? "" : single.unit.floor, maxLength: 20 },
            { kind: "number", name: "rooms", label: d.biens.wizRooms, value: single.unit.rooms ? String(single.unit.rooms) : "" },
            { kind: "number", name: "bedrooms", label: d.biens.wizBedrooms, value: single.unit.bedrooms ? String(single.unit.bedrooms) : "" },
            { kind: "toggle", name: "furnished", label: d.modify.furnished, value: single.unit.furnished, span: 2 },
          ],
        },
      }
    : { id: "characteristics", label: d.modify.characteristics, href: `/app/biens/${p.id}?onglet=lots` };

  const technical: EditTopic = {
    id: "technical",
    title: d.modify.technical,
    endpoint: `/api/biens/${p.id}`,
    method: "PATCH",
    fields: [
      {
        kind: "select",
        name: "energyClass",
        label: d.biens.wizEnergyClass,
        value: p.energyClass ?? "",
        options: [{ value: "", label: d.biens.cpeMissing }, ...["A+", "A", "B", "C", "D", "E", "F", "G", "H", "I"].map((c) => ({ value: c, label: c }))],
      },
      { kind: "date", name: "cpeIssuedOn", label: d.modify.cpeIssuedOn, value: p.cpeIssuedOn || "" },
      { kind: "number", name: "constructionYear", label: d.biens.wizYear, value: p.constructionYear ? String(p.constructionYear) : "" },
      { kind: "text", name: "syndicName", label: d.biens.syndic, value: p.syndicName ?? "", maxLength: 120 },
      { kind: "text", name: "cadastralCommune", label: d.bien.commune, value: "", maxLength: 80 },
      { kind: "text", name: "cadastralSection", label: d.biens.wizSection, value: "", maxLength: 20 },
      { kind: "text", name: "cadastralNumber", label: d.biens.wizParcel, value: "", maxLength: 40 },
      { kind: "toggle", name: "smokeDetectorsConfirmed", label: d.modify.smokeConfirmed, value: p.smokeDetectorsConfirmed, span: 2 },
    ],
    note: d.modify.metersNote,
  };

  const propertyPolicy = demo.INSURANCES.find((i) => i.propertyId === p.id) ?? null;
  const propertyInsurance: EditTopic = insuranceTopic(d, propertyPolicy, {
    title: d.modify.propertyInsurance,
    defaultKind: "building",
    extra: { propertyId: p.id },
  });

  const bien: MenuGroup = {
    label: d.modify.groupProperty,
    entries: [
      { id: "info", label: d.modify.propertyInfo, topic: info },
      { id: "photos", label: d.modify.photos, special: { kind: "photos", propertyId: p.id, currentUrl: p.photoUrl } },
      characteristics,
      { id: "technical", label: d.modify.technical, topic: technical },
      { id: "propertyInsurance", label: d.modify.propertyInsurance, topic: propertyInsurance },
    ],
  };

  /* ------------------------------- the tenancy ------------------------------- */

  const groups: MenuGroup[] = [bien];

  if (lease && live) {
    const deposit = demo.DEPOSITS.find((x) => x.leaseId === lease.id) ?? null;
    const payers = demo.IBAN_BINDINGS.filter((b) => b.leaseId === lease.id).map((b) => b.payerIban);
    const leasePolicy = demo.INSURANCES.find((i) => i.leaseId === lease.id) ?? null;

    // The engine, not the menu, decides whether an indexation is on the table.
    const capital = computeCapitalInvesti(lease.capitalComponents, demo.TODAY);
    const proposal =
      lease.type === "residential" && lease.capitalComponents.length > 0
        ? proposeResidentialAdjustment({
            currentMonthlyRent: lease.rentCents,
            lastAdjustmentDate: lease.lastAdjustmentOn,
            leaseStartDate: lease.startDate,
            proposedDate: demo.TODAY,
            capital,
          })
        : null;

    const entries: MenuEntry[] = [
      ...(tenant
        ? [
            {
              id: "tenant",
              label: d.modify.tenant,
              topic: {
                id: "tenant",
                title: d.modify.tenant,
                endpoint: `/api/contacts/${tenant.id}`,
                method: "PATCH" as const,
                fields: [
                  { kind: "text" as const, name: "firstName", label: d.location.firstName, value: firstOf(tenant.name), maxLength: 80 },
                  { kind: "text" as const, name: "lastName", label: d.location.lastName, value: lastOf(tenant.name), maxLength: 80 },
                  { kind: "text" as const, name: "email", label: d.location.email, value: tenant.email ?? "", maxLength: 160, span: 2 as const },
                  { kind: "text" as const, name: "phone", label: d.location.phone, value: tenant.phone ?? "", maxLength: 40, span: 2 as const },
                ],
              },
            },
          ]
        : []),
      {
        id: "lease",
        label: d.modify.lease,
        topic: {
          id: "lease",
          title: d.modify.lease,
          endpoint: `/api/baux/${lease.id}`,
          method: "PATCH",
          fields: [
            {
              kind: "select",
              name: "type",
              label: d.location.leaseType,
              value: lease.type,
              options: [
                { value: "residential", label: d.status.leaseType.residential },
                { value: "commercial", label: d.status.leaseType.commercial },
              ],
              span: 2,
            },
            { kind: "date", name: "startDate", label: d.location.startDate, value: lease.startDate },
            { kind: "date", name: "endDate", label: d.location.endDate, value: lease.endDate ?? "", hint: d.location.endDateHint },
          ],
        },
      },
      {
        id: "rent",
        label: d.modify.rent,
        topic: {
          id: "rent",
          title: d.modify.rent,
          endpoint: `/api/baux/${lease.id}`,
          method: "PATCH",
          fields: [
            { kind: "euro", name: "rent", label: d.location.rent, value: cents(lease.rentCents) },
            { kind: "euro", name: "charges", label: d.location.charges, value: cents(lease.chargesCents) },
            {
              kind: "select",
              name: "paymentDay",
              label: d.location.paymentDay,
              value: String(lease.paymentDay),
              options: Array.from({ length: 28 }, (_, i) => ({ value: String(i + 1), label: String(i + 1) })),
            },
            { kind: "date", name: "effectiveFrom", label: d.modify.effectiveFrom, value: "", hint: d.modify.effectiveFromHint },
          ],
          note: d.modify.rentNote,
        },
      },
      { id: "payers", label: d.modify.payment, special: { kind: "payers", leaseId: lease.id, payers } },
      ...(deposit
        ? [
            {
              id: "deposit",
              label: d.modify.guarantee,
              topic: {
                id: "deposit",
                title: d.modify.guarantee,
                endpoint: `/api/garanties/${deposit.id}`,
                method: "PATCH" as const,
                fields: [
                  {
                    kind: "select" as const,
                    name: "form",
                    label: d.location.depositForm,
                    value: deposit.form,
                    options: (["cash", "bank_guarantee", "third_party_caution", "insurance", "state_guarantee"] as const).map((f) => ({
                      value: f,
                      label: d.status.depositForm[f],
                    })),
                  },
                  { kind: "euro" as const, name: "amount", label: d.bien.depositAmount, value: cents(deposit.amountCents) },
                  {
                    kind: "select" as const,
                    name: "status",
                    label: d.bien.depositState,
                    value: deposit.status,
                    options: (["pending", "held", "release_pending", "partially_released", "released", "forfeited", "disputed"] as const).map(
                      (s) => ({ value: s, label: d.status.deposit[s] }),
                    ),
                  },
                  { kind: "date" as const, name: "receivedOn", label: d.modify.receivedOn, value: "" },
                ],
              },
            },
          ]
        : []),
      {
        id: "indexation",
        label: d.hubs.indexation,
        special: {
          kind: "indexation",
          leaseId: lease.id,
          allowed: Boolean(proposal?.allowed && proposal.proposedMonthlyRent > lease.rentCents),
          currentLabel: euros(lease.rentCents, locale),
          proposedLabel: proposal ? euros(proposal.proposedMonthlyRent, locale) : "",
          reason: proposal?.blockedReason ?? d.bien.indexationNone,
        },
      },
      { id: "edl", label: d.hubs.edl, href: `/app/biens/etat-des-lieux?bail=${lease.id}` },
      { id: "leaseInsurance", label: d.modify.rentalInsurance, topic: insuranceTopic(d, leasePolicy, { title: d.modify.rentalInsurance, defaultKind: "rent_guarantee", extra: { leaseId: lease.id } }) },
      { id: "departure", label: d.modify.departure, href: `/app/biens/depart?bail=${lease.id}` },
    ];

    groups.push({
      label: `${d.modify.groupRental} · ${live.tenantNames.join(", ") || live.unit.label}`,
      entries,
    });
  } else if (single) {
    groups.push({
      label: d.modify.groupRental,
      entries: [{ id: "addTenant", label: d.bien.addTenant, href: `/app/biens/locataire?lot=${single.unit.id}` }],
    });
  }

  /* -------------------------------- management ------------------------------- */

  groups.push({
    label: d.modify.groupManagement,
    entries: [
      { id: "documents", label: d.bien.tabDocuments, href: `/app/biens/${p.id}?onglet=documents` },
      { id: "interventions", label: d.bien.tabInterventions, href: `/app/biens/${p.id}?onglet=interventions` },
      { id: "history", label: d.bien.tabHistory, href: `/app/biens/${p.id}?onglet=historique` },
      {
        id: "archive",
        label: d.modify.archive,
        special: { kind: "archive", propertyId: p.id, propertyName: p.name, blocked: card.occupied > 0 },
      },
    ],
  });

  return { groups, hasLease: Boolean(lease) };
}

/* --------------------------------- helpers -------------------------------- */

function insuranceTopic(
  d: Dict,
  policy: { id: string; kind: string; provider: string; policyNumber: string; premiumCents: number; startsOn: string | null; expiresOn: string | null } | null,
  opts: { title: string; defaultKind: string; extra: Record<string, string> },
): EditTopic {
  const kinds = (["building", "pno", "liability", "rent_guarantee", "pi", "other"] as const).map((k) => ({
    value: k,
    label: d.status.insuranceKind[k],
  }));
  return {
    id: "insurance",
    title: opts.title,
    endpoint: policy ? `/api/assurances/${policy.id}` : "/api/assurances/create",
    method: policy ? "PATCH" : "POST",
    extra: policy ? undefined : opts.extra,
    fields: [
      { kind: "select", name: "kind", label: d.assurances.fieldKind, value: policy?.kind ?? opts.defaultKind, options: kinds, span: 2 },
      { kind: "text", name: "provider", label: d.assurances.fieldProvider, value: policy?.provider ?? "", required: true, maxLength: 120, span: 2 },
      { kind: "text", name: "policyNumber", label: d.assurances.fieldNumber, value: policy?.policyNumber ?? "", maxLength: 80 },
      { kind: "euro", name: "premium", label: d.assurances.fieldPremium, value: policy ? (policy.premiumCents / 100).toFixed(2).replace(".", ",") : "" },
      { kind: "date", name: "startsOn", label: d.assurances.fieldStarts, value: policy?.startsOn ?? "" },
      { kind: "date", name: "expiresOn", label: d.assurances.fieldExpires, value: policy?.expiresOn ?? "" },
    ],
  };
}

/** The demo shape stores a formatted address; the editor needs its parts. */
function addressPart(formatted: string, part: "street" | "number" | "postal"): string {
  const [first = ""] = formatted.split(",");
  if (part === "number") {
    const m = first.trim().match(/^(\d+[A-Za-z]?)\b/);
    return m ? m[1] : "";
  }
  if (part === "street") return first.replace(/^\d+[A-Za-z]?[,\s]+/, "").trim();
  const m = formatted.match(/\b([A-Z]{1,2}-\d{4,5})\b/);
  return m ? m[1] : "";
}

function firstOf(name: string): string {
  const parts = name.trim().split(/\s+/);
  return parts.length > 1 ? parts.slice(0, -1).join(" ") : name;
}
function lastOf(name: string): string {
  const parts = name.trim().split(/\s+/);
  return parts.length > 1 ? parts[parts.length - 1] : "";
}
