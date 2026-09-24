// @vitest-environment jsdom
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { fr } from "@/lib/i18n/fr";
import { buildEmptyData, orgFromWorkspace } from "@/lib/demo/data-empty";
import type { DemoData } from "@/lib/demo";

/**
 * The four operations screens over a real-shaped account: one live
 * residential tenancy with nothing declared yet, its guarantee still
 * pending, one intervention without a work order, one artisan. Each page
 * must offer the first action rather than an empty state: the rows are what
 * the real loader produces, read through the same seam.
 */
const today = new Date().toISOString().slice(0, 10);
/** The markup as text: React escapes quotes and ampersands, the dictionary does not. */
const text = (html: string): string => html.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
const monthsBack = (n: number): string => {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - n);
  return d.toISOString().slice(0, 10);
};

function account(): DemoData {
  const data = buildEmptyData(orgFromWorkspace({ id: "org-1", name: "Espace test", kind: "manager" }));
  const lease: DemoData["LEASES"][number] = {
    id: "lease-1",
    seq: 1,
    unitId: "unit-1",
    type: "residential",
    status: "active",
    tenantContactIds: ["c-tenant"],
    guarantorContactIds: [],
    colocation: false,
    startDate: monthsBack(25),
    endDate: null,
    rentCents: 125000,
    chargesCents: 15000,
    chargesRegime: "advances",
    depositMonths: 2,
    depositForm: "cash",
    paymentDay: 1,
    rfReference: "RF00 1234 0001",
    lastAdjustmentOn: null,
    previousRentCents: null,
    capitalComponents: [],
    vatRegime: "exempt",
  };
  return {
    ...data,
    CONTACTS: [
      { id: "c-tenant", kind: "natural", name: "Lena Schmit", email: null, phone: null, language: "fr", roles: ["tenant"] },
      { id: "c-artisan", kind: "natural", name: "Jos Kirsch", email: null, phone: null, language: "fr", roles: ["artisan"] },
    ],
    LEASES: [lease],
    RENT_PERIODS: [
      { id: "rp-1", leaseId: "lease-1", period: today.slice(0, 7), dueDate: today, rentCents: 125000, chargesCents: 15000, vatCents: 0, totalCents: 140000, allocatedCents: 0, status: "due" },
    ],
    DEPOSITS: [{ id: "dep-1", leaseId: "lease-1", form: "cash", amountCents: 250000, status: "pending", entryEdlExists: false, deductions: [], releasedFirstTrancheCents: 0, releasedBalanceCents: 0 }],
    TICKETS: [
      {
        id: "t-1", ref: "INT-T1", unitId: "unit-1", unitLabel: "Maison · Maison Schmit", leaseId: "lease-1", source: "manager", category: "heating", severity: "routine", status: "new",
        title: "Chaudière en panne", description: null, createdAt: today, updatedAt: today, closedAt: null, slaDueAt: null, conversationId: null, interventionId: null, attachments: [], workOrder: null,
      },
    ],
    leaseById: (id: string) => [lease].find((l) => l.id === id)!,
    leaseTenantNames: () => ["Lena Schmit"],
    leaseUnitLabel: () => "Maison · Maison Schmit",
  };
}

vi.mock("@/lib/demo", () => ({ getDemo: async () => account(), isSampleData: async () => false }));
vi.mock("@/lib/i18n", () => ({ getI18n: async () => ({ locale: "fr", d: fr }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }), usePathname: () => "/app" }));

describe("operations screens on a real account", () => {
  it("Indexation lists the live residential tenancy and asks for its capital investi", async () => {
    const { default: Page } = await import("@/app/app/indexation/page");
    const html = text(renderToString(await Page()));
    expect(html).toContain('data-indexation-lease="lease-1"');
    expect(html).toContain(fr.indexation.capitalNone);
    expect(html).toContain(fr.indexation.capitalDeclare);
  });
  it("Charges offers a first décompte for the tenancy", async () => {
    const { default: Page } = await import("@/app/app/charges/page");
    const html = text(renderToString(await Page({ searchParams: Promise.resolve({}) })));
    expect(html).toContain(fr.charges.newDecompte);
    expect(html).toContain(fr.charges.noneYet);
  });
  it("Garanties lists the pending guarantee with its receipt action", async () => {
    const { default: Page } = await import("@/app/app/garanties/page");
    const html = text(renderToString(await Page()));
    expect(html).toContain('data-deposit="dep-1"');
    expect(html).toContain(fr.garanties.actReceive);
  });
  it("Interventions opens the ticket's sheet", async () => {
    const { default: Page } = await import("@/app/app/interventions/page");
    const html = text(renderToString(await Page()));
    expect(html).toContain("Chaudière en panne");
    expect(html).toContain('data-intervention-open="t-1"');
  });
});
