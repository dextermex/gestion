// @vitest-environment jsdom
import { renderToString } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fr } from "@/lib/i18n/fr";
import { fmt } from "@/lib/i18n/config";
import { buildEmptyData, orgFromWorkspace } from "@/lib/demo/data-empty";
import type { DemoData } from "@/lib/demo";
import { addDays } from "@/domain/dates";

/**
 * Loyers on a real-shaped account: a month part-paid before it falls due is
 * still to come, as the tenant reads it, and is counted late from the day
 * after its due date only (FE-006, TEN-027).
 */
const today = new Date().toISOString().slice(0, 10);
const text = (html: string): string => html.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");

let dueDate = addDays(today, 3);

function account(): DemoData {
  const data = buildEmptyData(orgFromWorkspace({ id: "org-1", name: "Espace test", kind: "manager" }));
  const lease: DemoData["LEASES"][number] = {
    id: "lease-1", seq: 1, unitId: "unit-1", type: "residential", status: "active", tenantContactIds: ["c-tenant"], guarantorContactIds: [], colocation: false,
    startDate: addDays(today, -400), endDate: null, rentCents: 125000, chargesCents: 15000, chargesRegime: "advances", depositMonths: 2, depositForm: "cash", paymentDay: 28,
    rfReference: "", lastAdjustmentOn: null, previousRentCents: null, capitalComponents: [], vatRegime: "exempt",
  };
  return {
    ...data,
    TODAY: today,
    CONTACTS: [{ id: "c-tenant", kind: "natural", name: "Lena Schmit", email: null, phone: null, language: "fr", roles: ["tenant"] }],
    LEASES: [lease],
    RENT_PERIODS: [
      // Part-paid; the status the read model gives a part-paid month whatever its date.
      { id: "rp-1", leaseId: "lease-1", period: today.slice(0, 7), dueDate, rentCents: 125000, chargesCents: 15000, vatCents: 0, totalCents: 140000, allocatedCents: 70000, status: "partial" },
    ],
    leaseById: () => lease,
    leaseTenantNames: () => ["Lena Schmit"],
    leaseUnitLabel: () => "Maison · Maison Schmit",
  };
}

vi.mock("@/lib/demo", () => ({ getDemo: async () => account(), isSampleData: async () => false }));
vi.mock("@/lib/i18n", () => ({ getI18n: async () => ({ locale: "fr", d: fr }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }), usePathname: () => "/app/loyers" }));

describe("Loyers and a month part-paid", () => {
  beforeEach(() => {
    dueDate = addDays(today, 3);
  });

  it("lists it as still to come before its due date, with nobody late", async () => {
    const { default: Page } = await import("@/app/app/loyers/page");
    const html = text(renderToString(await Page({ searchParams: Promise.resolve({}) })));
    expect(html).not.toContain(fmt(fr.loyers.chipLate, { n: 1 }));
    expect(html).toContain(fr.loyers.groupUpcoming);
  });

  it("counts it late from the day after it fell due", async () => {
    dueDate = addDays(today, -1);
    const { default: Page } = await import("@/app/app/loyers/page");
    const html = text(renderToString(await Page({ searchParams: Promise.resolve({}) })));
    expect(html).toContain(fmt(fr.loyers.chipLate, { n: 1 }));
  });
});
