// @vitest-environment jsdom
import { renderToString } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fr } from "@/lib/i18n/fr";
import { fmt } from "@/lib/i18n/config";
import { buildEmptyData, orgFromWorkspace } from "@/lib/demo/data-empty";
import type { DemoData } from "@/lib/demo";
import { todayISO } from "@/lib/clock";
import { formatMonth } from "@/lib/types";
import * as cabinet from "@/lib/demo/data";

/**
 * Where the manager screens lead on an account's own data. Every card,
 * chip and link of these pages must open something that exists: a screen
 * with content, never an empty page or a control that does nothing. The
 * rows are what the real loader produces, read through the same seam.
 */
const today = todayISO();
const month = today.slice(0, 7);
/** The markup as text: React escapes quotes and ampersands, the dictionary does not. */
const text = (html: string): string => html.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
/** Every in-app address a rendered page links to. */
const hrefs = (html: string): string[] => [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1].replace(/&amp;/g, "&"));

const property: DemoData["PROPERTIES"][number] = { id: "prop-1", name: "Maison Schmit", address: "1, rue du Test", commune: "Luxembourg", cadastralRef: "", type: "house", constructionYear: 2015, completionDate: "", energyClass: "", cpeIssuedOn: "", isCopropriete: false, smokeDetectorsConfirmed: true, ownerContactIds: [], ownershipNote: "", unitsCount: 1, photoUrl: null };
const lease: DemoData["LEASES"][number] = {
  id: "lease-1", seq: 1, unitId: "unit-1", type: "residential", status: "active", tenantContactIds: ["c-tenant"], guarantorContactIds: [], colocation: false,
  startDate: `${Number(month.slice(0, 4)) - 2}-01-01`, endDate: null, rentCents: 125000, chargesCents: 15000, chargesRegime: "advances", depositMonths: 2, depositForm: "cash",
  paymentDay: 1, rfReference: "RF00 1234 0001", lastAdjustmentOn: null, previousRentCents: null, capitalComponents: [], vatRegime: "exempt",
};

/** An empty workspace: what a new account reads. */
function empty(): DemoData {
  return buildEmptyData(orgFromWorkspace({ id: "org-1", name: "Espace test", kind: "owner" }));
}

/** One let house, this month's rent paid, one bill: no fiscal year, no sample record. */
function account(): DemoData {
  return {
    ...empty(),
    CONTACTS: [{ id: "c-tenant", kind: "natural", name: "Lena Schmit", email: null, phone: null, language: "fr", roles: ["tenant"] }],
    PROPERTIES: [property],
    UNITS: [{ id: "unit-1", propertyId: "prop-1", label: "Maison", kind: "dwelling", floor: "", areaSqm: 120, rooms: 4, furnished: false, photoUrl: null }],
    LEASES: [lease],
    RENT_PERIODS: [{ id: "rp-1", leaseId: "lease-1", period: month, dueDate: `${month}-01`, rentCents: 125000, chargesCents: 15000, vatCents: 0, totalCents: 140000, allocatedCents: 140000, status: "paid" }],
    BILLS: [
      { id: "bill-1", direction: "expense", supplierContactId: null, supplierName: "Jos Kirsch", propertyId: "prop-1", unitId: "unit-1", unitLabel: "Maison · Maison Schmit", category: "maintenance_repairs", subject: "Chaudière", docNo: "K-1", docDate: `${month}-02`, dueOn: null, paidOn: null, cashflow: true, vatRatePct: 17, amountCents: 40000, vatCents: 5812, documentId: null, hasDocument: false, createdAt: today },
    ],
    leaseById: () => lease,
    propertyById: () => property,
    leaseTenantNames: () => ["Lena Schmit"],
    leaseUnitLabel: () => "Maison · Maison Schmit",
  };
}

let data: DemoData = account();
let sample = false;
vi.mock("@/lib/demo", () => ({ getDemo: async () => data, isSampleData: async () => sample, getDatasetId: async () => (sample ? "fr" : "real") }));
vi.mock("@/lib/i18n", () => ({ getI18n: async () => ({ locale: "fr", d: fr }) }));
vi.mock("@/lib/workspace", () => ({ getIdentity: async () => ({ userId: "u-1", email: "lena@example.invalid", displayName: "Nadia Kremer", workspaces: [], active: { id: "org-1", name: "Espace test", kind: "owner", role: "owner" } }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }), usePathname: () => "/app", redirect: (to: string) => { throw new Error(`redirect:${to}`); }, notFound: () => { throw new Error("not-found"); } }));

beforeEach(() => {
  data = account();
  sample = false;
});

describe("Fiscalité on an account's own data", () => {
  const render = async (params: Record<string, string> = {}) => {
    const { default: Page } = await import("@/app/app/fiscalite/page");
    return text(renderToString(await Page({ searchParams: Promise.resolve(params) })));
  };

  it("reads this quarter and the year so far from the rent periods and the bills", async () => {
    const html = await render();
    expect(html).toContain(fr.fiscalite.quarterTitle);
    expect(html).toContain(fr.fiscalite.ytdTitle);
    // 1 400 € of rent in, 400 € of bills out: 1 000 € left, on both cards.
    expect(html.match(/1[\s  .]?000/g)?.length).toBeGreaterThanOrEqual(2);
    expect(html).toContain(fr.fiscalite.stepsTitle);
    expect(html).toContain(fr.fiscalite.calendarTitle);
    expect(hrefs(html)).toEqual(expect.arrayContaining(["/app/finance?vue=revenus", "/app/finance?vue=charges"]));
  });

  it("says the pack is not produced yet and offers no control for it", async () => {
    const html = await render();
    expect(html).toContain(fr.fiscalite.packSoonTitle);
    expect(html).toContain(fr.fiscalite.packSoonBody);
    expect(html).not.toContain("/api/fiscalite/pack");
    expect(html).not.toContain(fr.fiscalite.downloadPdf);
    expect(html).not.toContain(fr.fiscalite.tabDetail);
  });

  it("counts one annex per property let in the exercise the next return covers", async () => {
    const html = await render();
    const running = Number(today.slice(0, 4));
    // The return for last year is due on 31 December of this one: it is the one ahead until then.
    expect(html).toContain(fmt(fr.fiscalite.calReturn, { year: running - 1 }));
    expect(html).toContain(fr.fiscalite.stateUpcoming);
    expect(html).not.toContain(fr.fiscalite.stateLate);
  });

  it("keeps the plain empty state for a workspace with nothing recorded", async () => {
    data = empty();
    const html = await render();
    expect(html).toContain(fmt(fr.common.emptyTitle, { section: fr.fiscalite.title }));
    expect(html).not.toContain(fr.fiscalite.quarterTitle);
  });
});

describe("Rapports", () => {
  const render = async () => {
    const { default: Page } = await import("@/app/app/rapports/page");
    return text(renderToString(await Page({ searchParams: Promise.resolve({}) })));
  };

  it("links the tax summary and lists the tax pack as not built on an account without a prepared exercise", async () => {
    const html = await render();
    expect(hrefs(html)).toContain("/app/fiscalite");
    expect(hrefs(html)).not.toContain("/app/fiscalite?vue=detail");
    // The pack's card is there, marked, and is not a link.
    const card = html.slice(html.indexOf(fr.reports.items.taxPack.title) - 600, html.indexOf(fr.reports.items.taxPack.title) + 200);
    expect(card).toContain('aria-disabled="true"');
    expect(card).toContain(fr.reports.soon);
  });
});

describe("Baux", () => {
  const render = async (params: Record<string, string> = {}) => {
    const { default: Page } = await import("@/app/app/baux/page");
    return text(renderToString(await Page({ searchParams: Promise.resolve(params) })));
  };

  it("says there is no lease yet and where one starts, instead of a filter that cannot be reset", async () => {
    data = empty();
    const html = await render();
    expect(html).toContain(fr.baux.noneTitle);
    expect(html).toContain(fr.baux.noneBody);
    expect(html).not.toContain(fr.common.resetFilters);
    expect(hrefs(html)).toContain("/app/biens");
  });

  it("keeps the reset link for a filter that matched nothing", async () => {
    const html = await render({ statut: "preavis" });
    expect(html).toContain(fr.baux.emptyTitle);
    expect(html).toContain(fr.common.resetFilters);
    expect(html).not.toContain(fr.baux.noneTitle);
  });
});

describe("Loyers", () => {
  const render = async (params: Record<string, string> = {}) => {
    const { default: Page } = await import("@/app/app/loyers/page");
    return text(renderToString(await Page({ searchParams: Promise.resolve(params) })));
  };
  /** The month before this one, unpaid and past its due date. */
  const withArrears = (): DemoData => {
    const [y, m] = month.split("-").map(Number);
    const prev = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
    const base = account();
    return { ...base, RENT_PERIODS: [...base.RENT_PERIODS, { id: "rp-0", leaseId: "lease-1", period: prev, dueDate: `${prev}-01`, rentCents: 125000, chargesCents: 15000, vatCents: 0, totalCents: 140000, allocatedCents: 0, status: "late" }] };
  };

  it("names the view on screen and offers the way out of it", async () => {
    data = withArrears();
    const html = await render({ vue: "impayes" });
    expect(html).toContain(fr.loyers.tabsAria);
    // The three views are links; the one on screen is marked.
    expect(hrefs(html)).toEqual(expect.arrayContaining(["/app/loyers", "/app/loyers?vue=impayes", "/app/loyers?vue=payes"]));
    expect(html).toMatch(/aria-current="page"[^>]*>À encaisser/);
    // The paid rent of the month is not in this view.
    expect(html).not.toContain(fmt(fr.loyers.groupPaid, { n: 1 }));
    expect(html).toContain(fr.loyers.groupEarlier);
  });

  it("keeps the view when the month changes", async () => {
    data = withArrears();
    const html = await render({ vue: "impayes" });
    const prevMonthLink = hrefs(html).find((h) => h.startsWith("/app/loyers?mois="));
    expect(prevMonthLink).toContain("vue=impayes");
  });

  it("sends the late chip to the rows it counts, also from the paid view", async () => {
    data = withArrears();
    expect(hrefs(await render())).toContain("#a-encaisser");
    const paid = await render({ vue: "payes" });
    expect(paid).not.toContain('id="a-encaisser"');
    expect(hrefs(paid)).not.toContain("#a-encaisser");
    expect(hrefs(paid)).toContain("/app/loyers?vue=impayes#a-encaisser");
  });

  it("opens every month Accueil can show", async () => {
    const { monthWindow } = await import("@/lib/months");
    const oldest = monthWindow(month)[0];
    const html = await render({ mois: oldest });
    // The oldest month of the window is shown as asked, not replaced by the current one.
    expect(html).toContain(fmt(fr.loyers.heroLabel, { month: formatMonth(oldest, "fr") }));
    expect(html).not.toContain(fmt(fr.loyers.groupPaid, { n: 1 }));
    expect(html).toContain(fr.loyers.nothingDue);
  });
});

describe("Accueil", () => {
  const render = async (params: Record<string, string> = {}) => {
    const { default: Page } = await import("@/app/app/page");
    return text(renderToString(await Page({ searchParams: Promise.resolve(params) })));
  };

  it("does not say everything is collected while a rent of the month is still to come", async () => {
    const base = account();
    data = { ...base, RENT_PERIODS: base.RENT_PERIODS.map((rp) => ({ ...rp, allocatedCents: 0, status: "pending" as const })) };
    const html = await render();
    expect(html).toContain("0/1");
    expect(html).not.toContain(fr.home.ringAllPaid);
    expect(html).toContain(fmt(fr.home.ringOpen, { n: 1 }));
  });

  it("says everything is collected once every rent of the month is paid", async () => {
    const html = await render();
    expect(html).toContain("1/1");
    expect(html).toContain(fr.home.ringAllPaid);
  });

  it("opens the properties from the lots chip, and Loyers on the month shown from the month chip", async () => {
    const { monthWindow } = await import("@/lib/months");
    const oldest = monthWindow(month)[0];
    const html = await render({ mois: oldest });
    expect(hrefs(html)).toContain("/app/biens");
    expect(hrefs(html)).not.toContain("/app/biens?occupation=vacants");
    expect(hrefs(html)).toContain(`/app/loyers?mois=${oldest}`);
  });
});

describe("États des lieux", () => {
  it("links a session to its lease sheet only when that sheet exists", async () => {
    // The sample cabinet keeps an exit inspection for a tenancy it no longer lists.
    data = cabinet;
    sample = true;
    const { default: Page } = await import("@/app/app/edl/page");
    const html = text(renderToString(await Page()));
    const sheets = new Set(cabinet.LEASES.map((l) => l.id));
    const orphan = cabinet.EDLS.find((e) => !sheets.has(e.leaseId))!;
    expect(orphan, "the sample has such a session").toBeDefined();
    expect(html).toContain(orphan.unitLabel);
    expect(hrefs(html)).not.toContain(`/app/baux/${orphan.leaseId}?onglet=edl`);
    for (const e of cabinet.EDLS.filter((x) => sheets.has(x.leaseId))) expect(hrefs(html)).toContain(`/app/baux/${e.leaseId}?onglet=edl`);
  });
});

describe("Finance", () => {
  const render = async (params: Record<string, string> = {}) => {
    const { default: Page } = await import("@/app/app/finance/page");
    return text(renderToString(await Page({ searchParams: Promise.resolve(params) })));
  };
  const twoProperties = (): DemoData => {
    const base = account();
    return { ...base, PROPERTIES: [...base.PROPERTIES, { ...property, id: "prop-2", name: "Studio Gare" }] };
  };

  it("keeps a stretch of months to Trésorerie: the other views are not opened on it", async () => {
    data = twoProperties();
    const html = await render({ periode: "12m", bien: "prop-1" });
    expect(html).toContain(fmt(fr.finance.heroLabel, { month: fr.finance.span12 }));
    const views = hrefs(html).filter((h) => h.startsWith("/app/finance?") && h.includes("vue="));
    expect(views.length).toBeGreaterThan(0);
    for (const h of views) expect(h, h).not.toContain("periode=");
    // The property stays: it is shown, and can be changed, on every view.
    for (const h of views) expect(h, h).toContain("bien=prop-1");
  });

  it("reads Revenus for the month on screen even when the address still names a stretch", async () => {
    data = twoProperties();
    const html = await render({ vue: "revenus", periode: "12m" });
    expect(html).toContain(fmt(fr.finance.heroLabel, { month: formatMonth(month, "fr") }));
    expect(html).not.toContain(fmt(fr.finance.heroLabel, { month: fr.finance.span12 }));
    // The property select is there outside Trésorerie; the period select is not.
    expect(html).toContain(`aria-label="${fr.finance.propertyAria}"`);
    expect(html).not.toContain(`aria-label="${fr.finance.periodAria}"`);
  });
});

describe("AML", () => {
  it("says in plain words that the screen is not available on an account's own data", async () => {
    const { default: Page } = await import("@/app/app/aml/page");
    const html = text(renderToString(await Page()));
    expect(html).toContain(fr.aml.soonTitle);
    expect(html).toContain(fr.aml.soonBody);
    // Not the empty state that promises to fill as records arrive: no record would ever fill it.
    expect(html).not.toContain(fr.common.emptyBody);
  });
});
