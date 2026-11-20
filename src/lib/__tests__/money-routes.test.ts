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
