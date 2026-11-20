import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { OrgContext } from "@/lib/gestion/api";
import { addDays, addMonths } from "@/domain/dates";
import { openLedger } from "@/lib/gestion/lease";
import { FakeDb, type Row } from "./helpers/fake-postgrest";
import { ORG, ctxFor, isoToday, letTo, seedProperty } from "./helpers/tenancy";

/**
 * The money routes, called as the screens call them, over one database:
 * the session and the workspace are the test's, everything after is the
 * route's own code.
 */
let current: OrgContext;
vi.mock("@/lib/gestion/api", async (load) => {
  const actual = await load<typeof import("@/lib/gestion/api")>();
  return { ...actual, withOrg: async () => current, withOrgAndClient: async () => current };
});
vi.mock("@/lib/i18n", async () => {
  const { fr } = await import("@/lib/i18n/fr");
  return { getI18n: async () => ({ locale: "fr", d: fr }) };
});

const today = isoToday();
const thisMonth = `${today.slice(0, 7)}-01`;
const ANNA = { firstName: "Anna", lastName: "Weber", email: "anna.weber@example.lu" };

const call = (url: string, method: string, body?: unknown) =>
  new NextRequest(`https://app.morada.lu${url}`, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });

describe("issuing a décompte", () => {
  let db: FakeDb;
  let leaseId: string;

  beforeEach(async () => {
    db = new FakeDb(today);
    current = ctxFor(db);
    const { unitId } = seedProperty(db);
    leaseId = (await letTo(current, unitId, [ANNA], "1 250", addMonths(thisMonth, -14))).leaseId;
    // The ledger as the nightly roll keeps it: through next month.
    await openLedger(current, { id: leaseId, startDate: addMonths(thisMonth, -14), endDate: null, rentCents: 125000, chargesCents: 15000, paymentDay: 1 }, today);
  });

  const draft = (balance: number): Row =>
    db.insertRow("charge_periods", { org_id: ORG, lease_id: leaseId, year: Number(today.slice(0, 4)) - 1, regime: "advances", status: "draft", advances_billed_cents: 100000, actual_cents: 100000 + balance });
  const issue = async (id: unknown) => {
    const { POST } = await import("@/app/api/charges/periodes/[id]/emettre/route");
    return POST(call(`/api/charges/periodes/${String(id)}/emettre`, "POST", { issuedOn: today }), params({ id: String(id) }));
  };

  it("carries the balance onto the first month nobody paid that falls due no earlier than the décompte, in one step", async () => {
    const cp = draft(30000);
    const res = await issue(cp.id);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { balanceCents: number; carriedTo: string; dueOn: string };
    expect(body.balanceCents).toBe(30000);
    expect(body.dueOn).toBe(addDays(today, 30));
    const target = db.table("rent_periods").find((rp) => rp.lease_id === leaseId && rp.other_cents === 30000)!;
    expect(String(target.period).slice(0, 7)).toBe(body.carriedTo);
    // Never due before the décompte says: this month, already due, is passed over.
    expect(String(target.due_date) >= body.dueOn).toBe(true);
    expect(body.carriedTo > today.slice(0, 7)).toBe(true);
    expect(db.table("charge_periods").find((x) => x.id === cp.id)).toMatchObject({ status: "issued", issued_on: today });
    // Issued once.
    expect((await issue(cp.id)).status).toBe(409);
  });

  it("opens a period of its own for a tenancy paid ahead or ended, and always says where", async () => {
    // Every open month paid: nothing free to carry onto.
    for (const rp of db.table("rent_periods").filter((r) => r.lease_id === leaseId)) {
      db.insertRow("payments", { id: `pay-${String(rp.id)}`, org_id: ORG, lease_id: leaseId, received_on: today, amount_cents: rp.total_cents, method: "transfer" });
      db.insertRow("payment_allocations", { org_id: ORG, payment_id: `pay-${String(rp.id)}`, rent_period_id: rp.id, amount_cents: rp.total_cents });
    }
    const res = await issue(draft(12000).id);
    const body = (await res.json()) as { carriedTo: string | null };
    expect(body.carriedTo).not.toBeNull();
    const own = db.table("rent_periods").find((rp) => rp.lease_id === leaseId && rp.other_cents === 12000)!;
    expect(String(own.period).slice(0, 7)).toBe(body.carriedTo);
    expect(db.rowsOf("rent_period_status").find((r) => r.id === own.id)?.status).not.toBe("paid");
  });

  it("issues through the old steps on a base without the function", async () => {
    db.absentRpc.add("issue_charge_period");
    const res = await issue(draft(5000).id);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { balanceCents: number }).balanceCents).toBe(5000);
  });
});

describe("changing the rent of a tenancy in force", () => {
  let db: FakeDb;
  let leaseId: string;
  const nextMonth = addMonths(thisMonth, 1);

  beforeEach(async () => {
    db = new FakeDb(today);
    current = ctxFor(db);
    const { unitId } = seedProperty(db);
    leaseId = (await letTo(current, unitId, [ANNA], "1 250", addMonths(thisMonth, -3))).leaseId;
    await openLedger(current, { id: leaseId, startDate: addMonths(thisMonth, -3), endDate: null, rentCents: 125000, chargesCents: 15000, paymentDay: 1 }, today);
  });

  const lease = () => db.table("leases").find((l) => l.id === leaseId)!;
  const period = (month: string) => db.table("rent_periods").find((rp) => rp.lease_id === leaseId && rp.period === month)!;
  const patch = async (body: Record<string, unknown>) => {
    const { PATCH } = await import("@/app/api/baux/[id]/route");
    return PATCH(call(`/api/baux/${leaseId}`, "PATCH", body), params({ id: leaseId }));
  };

  it("sends a dwelling's rise to the indexation, and takes a typing error corrected", async () => {
    const refused = await patch({ rent: "1 300" });
    expect(refused.status).toBe(409);
    expect(((await refused.json()) as { error: string }).error).toBe("rent_increase_needs_letter");
    expect(lease().rent_cents).toBe(125000);

    const corrected = await patch({ rent: "1 300", correction: true });
    expect(corrected.status).toBe(200);
    expect(lease()).toMatchObject({ rent_cents: 130000, previous_rent_cents: 125000 });
    // Months already due keep their amount; the next one, still to come, takes the new rent.
    expect(period(thisMonth).rent_cents).toBe(String(period(thisMonth).due_date) < today ? 125000 : 130000);
    expect(period(nextMonth).rent_cents).toBe(130000);
    expect(period(addMonths(thisMonth, -1)).rent_cents).toBe(125000);
  });

  it("keeps a rent from a later month on the lease until then, and the months from it open at that amount", async () => {
    const res = await patch({ rent: "1 200", charges: "160", effectiveFrom: `${nextMonth.slice(0, 7)}-15` });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { effectiveFrom: string; repriced: number })).toMatchObject({ effectiveFrom: nextMonth, repriced: 1 });
    // The rent in force, what the tenant reads, has not changed yet.
    expect(lease()).toMatchObject({ rent_cents: 125000, charges_cents: 15000 });
    expect((lease().details as Record<string, unknown>).rentChange).toEqual({ from: nextMonth, rentCents: 120000, chargesCents: 16000 });
    expect(period(nextMonth)).toMatchObject({ rent_cents: 120000, charges_cents: 16000 });
    expect(period(thisMonth)).toMatchObject({ rent_cents: 125000, charges_cents: 15000 });
    // A month opened later (the roll, or the ledger opened again) takes the new amount from its month.
    const later = new FakeDb(addMonths(thisMonth, 2));
    later.replace("rent_periods", db.table("rent_periods"));
    later.replace("leases", db.table("leases"));
    const { readRentChange } = await import("@/lib/gestion/lease");
    await openLedger(ctxFor(later), { id: leaseId, startDate: addMonths(thisMonth, -3), endDate: null, rentCents: 125000, chargesCents: 15000, paymentDay: 1, rentChange: readRentChange(lease().details) }, addMonths(thisMonth, 2));
    expect(later.table("rent_periods").find((rp) => rp.lease_id === leaseId && rp.period === addMonths(thisMonth, 3))).toMatchObject({ rent_cents: 120000 });
    // The sheet says what is coming.
    const { hydrate } = await import("./helpers/tenancy");
    expect((await hydrate(db)).LEASES.find((l) => l.id === leaseId)?.rentChange).toEqual({ from: nextMonth, rentCents: 120000, chargesCents: 16000 });
    // A later edit from this month replaces what was waiting.
    await patch({ rent: "1 150" });
    expect(lease().rent_cents).toBe(115000);
    expect((lease().details as Record<string, unknown>).rentChange).toBeUndefined();
  });

  it("moves the months still to come to a new payment day, never onto a day already behind", async () => {
    const res = await patch({ paymentDay: "10" });
    expect(res.status).toBe(200);
    expect(period(nextMonth).due_date).toBe(`${nextMonth.slice(0, 7)}-10`);
    // This month fell due already: it stays as it was.
    expect(period(thisMonth).due_date).toBe(thisMonth);
    expect(period(addMonths(thisMonth, -1)).due_date).toBe(addMonths(thisMonth, -1));
  });
});

describe("the arrears ladder and the adjustment letter", () => {
  let db: FakeDb;
  let leaseId: string;
  let contactIds: string[];
  const LUC = { firstName: "Luc", lastName: "Weber", email: "luc.weber@example.lu" };

  beforeEach(async () => {
    db = new FakeDb(today);
    current = ctxFor(db);
    const { unitId } = seedProperty(db);
    ({ leaseId, contactIds } = await letTo(current, unitId, [ANNA, LUC], "1 250", addMonths(thisMonth, -26)));
    await openLedger(current, { id: leaseId, startDate: addMonths(thisMonth, -26), endDate: null, rentCents: 125000, chargesCents: 15000, paymentDay: 1 }, today);
  });

  const late = () => db.table("rent_periods").filter((rp) => rp.lease_id === leaseId).sort((a, b) => (String(a.period) < String(b.period) ? -1 : 1))[0];
  const step = async (stage: string, rentPeriodId: unknown) => {
    const { POST } = await import("@/app/api/baux/[id]/relances/route");
    return POST(call(`/api/baux/${leaseId}/relances`, "POST", { stage, rentPeriodId: String(rentPeriodId) }), params({ id: leaseId }));
  };

  it("names every tenant of record, a closed tenancy's included, and records a step once", async () => {
    const rp = late();
    // The tenancy closed since: its people left on its last day.
    const { departOn } = await import("./helpers/tenancy");
    await departOn(db, current, leaseId, addDays(today, -1));
    const res = await step("mise_en_demeure", rp.id);
    expect(res.status).toBe(200);
    const letter = db.table("registered_letters")[0];
    expect([...((letter.content as Record<string, unknown>).recipientContactIds as string[])].sort()).toEqual([...contactIds].sort());
    expect(contactIds).toContain(letter.recipient_contact_id);
    expect(db.table("arrears_actions").find((a) => a.rent_period_id === rp.id)?.registered_letter_id).toBe(letter.id);
    expect((await step("mise_en_demeure", rp.id)).status).toBe(409);
    expect(db.table("registered_letters")).toHaveLength(1);
  });

  it("says the base is behind when the letter cannot carry its content, and records nothing", async () => {
    db.absentColumns.set("registered_letters", new Set(["content"]));
    const res = await step("mise_en_demeure", late().id);
    expect(res.status).toBe(503);
    expect(((await res.json()) as { error: string }).error).toBe("schema_outdated");
    expect(db.table("arrears_actions")).toHaveLength(0);
    expect(db.table("registered_letters")).toHaveLength(0);
  });

  it("applies the rent the letter announced, never today's larger computation", async () => {
    const lease = db.table("leases").find((l) => l.id === leaseId)!;
    lease.capital_investi = [{ year: 2010, amount: 100_000_000, kind: "construction" }];
    // The letter announced 1 280,00 €; the engine, today, would allow more.
    db.insertRow("registered_letters", {
      org_id: ORG, template_key: "rent_adjustment", related_type: "lease", related_id: leaseId, content_sha256: "x", status: "ar_received",
      dispatched_on: addDays(today, -40), ar_received_on: addDays(today, -35), content: { template: "rent_adjustment", proposedRentCents: 128000 },
    });
    const { POST } = await import("@/app/api/baux/[id]/indexation/route");
    const res = await POST(call(`/api/baux/${leaseId}/indexation`, "POST"), params({ id: leaseId }));
    expect(res.status).toBe(200);
    expect(((await res.json()) as { newRentCents: number }).newRentCents).toBe(128000);
    expect(lease.rent_cents).toBe(128000);
  });
});

describe("setting one month's amount", () => {
  let db: FakeDb;
  let leaseId: string;
  // A tenancy that began on the 17th of this month.
  const start = `${thisMonth.slice(0, 7)}-17`;

  beforeEach(async () => {
    db = new FakeDb(today < start ? start : today);
    current = ctxFor(db);
    const { unitId } = seedProperty(db);
    leaseId = (await letTo(current, unitId, [ANNA], "1 250", start)).leaseId;
  });

  const first = () => db.table("rent_periods").find((rp) => rp.lease_id === leaseId && rp.period === thisMonth)!;
  const adjust = async (periodId: unknown, body: Record<string, unknown>) => {
    const { PATCH } = await import("@/app/api/baux/[id]/echeances/[periodId]/route");
    return PATCH(call(`/api/baux/${leaseId}/echeances/${String(periodId)}`, "PATCH", body), params({ id: leaseId, periodId: String(periodId) }));
  };

  it("cuts the first month to the days the tenancy covers, once, and keeps why", async () => {
    const res = await adjust(first().id, { prorata: true });
    expect(res.status).toBe(200);
    const days = Number(addDays(addMonths(thisMonth, 1), -1).slice(8)) - 16;
    const total = Number(addDays(addMonths(thisMonth, 1), -1).slice(8));
    expect(first()).toMatchObject({ rent_cents: Math.round((125000 * days) / total), charges_cents: Math.round((15000 * days) / total), adjust_reason: `prorata ${days}/${total}` });
    expect(first().adjusted_at).not.toBeNull();
    expect((await adjust(first().id, { prorata: true })).status).toBe(409);
    // Next month is covered whole: nothing to cut.
    const next = db.table("rent_periods").find((rp) => rp.lease_id === leaseId && rp.period === addMonths(thisMonth, 1))!;
    expect(((await (await adjust(next.id, { prorata: true })).json()) as { error: string }).error).toBe("not_partial");
  });

  it("takes an amount stated with its reason, never on a month something was paid on", async () => {
    expect((await adjust(first().id, { rent: "600", charges: "0" })).status).toBe(400);
    expect((await adjust(first().id, { rent: "600", charges: "0", reason: "Arrivée en cours de mois" })).status).toBe(200);
    expect(first()).toMatchObject({ rent_cents: 60000, charges_cents: 0, total_cents: 60000 });
    db.insertRow("payments", { id: "pay-1", org_id: ORG, lease_id: leaseId, received_on: db.today, amount_cents: 100, method: "transfer" });
    db.insertRow("payment_allocations", { org_id: ORG, payment_id: "pay-1", rent_period_id: first().id, amount_cents: 100 });
    const refused = await adjust(first().id, { rent: "500", charges: "0", reason: "Autre" });
    expect(refused.status).toBe(409);
    expect(((await refused.json()) as { error: string }).error).toBe("paid");
    expect((await adjust("nope", { prorata: true })).status).toBe(404);
  });

  it("writes the amounts alone on a base without the trace columns", async () => {
    db.absentColumns.set("rent_periods", new Set(["adjusted_at", "adjusted_by", "adjust_reason"]));
    expect((await adjust(first().id, { rent: "700", charges: "50", reason: "Accord" })).status).toBe(200);
    expect(first()).toMatchObject({ rent_cents: 70000, charges_cents: 5000 });
  });
});
