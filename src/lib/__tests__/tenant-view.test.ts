import { describe, expect, it } from "vitest";
import { visitWhen } from "@/lib/portal/format";
import { SEEN_COOKIE, parseSeen, serializeSeen } from "@/lib/portal/seen";
import type { TenantConversation, TenantLease, TenantPayments, TenantPeriod, TenantRequest } from "@/lib/portal/tenant-space";
import { paymentsOf } from "@/lib/portal/tenant-space";
import { rentDue, requestTimeline, todoFor, unreadCount, upcomingFor } from "@/lib/portal/view";

/**
 * What the tenant's screens say, derived from the rows and nothing else:
 * what is owed now and the one cause the ledger can show, what there is to
 * do, the dated things ahead, a request's path, and what is unread.
 */
const TODAY = "2026-08-23";

const period = (p: Partial<TenantPeriod> & { period: string }): TenantPeriod => ({
  id: `rp-${p.period}`, dueDate: `${p.period}-01`, rentCents: 152000, chargesCents: 22000, otherCents: 0, vatCents: 0, totalCents: 174000, allocatedCents: 174000, status: "paid", ...p,
});
const lease = (over: Partial<TenantLease> = {}): TenantLease => ({
  id: "l-1", orgId: "o-1", unitId: "u-1", propertyId: "p-1", status: "active", type: "residential", startDate: "2023-04-01", endDate: null,
  rentCents: 152000, chargesCents: 22000, chargesRegime: "advances", paymentDay: 1, rfReference: "RF21000100000001", furnished: false, colocation: false,
  lastAdjustmentOn: "2026-04-01", previousRentCents: 145000,
  unit: { label: "Apt 3B", floor: "3e", areaSqm: 72, rooms: 3, bedrooms: 2 },
  property: { name: "Résidence Beaulieu", address: "12, rue de la Gare", commune: "Luxembourg", energyClass: "C", cpeIssuedOn: null, syndicName: null, smokeDetectorsConfirmed: true, photoPath: null, photoUrl: null },
  parties: [], deposit: null, edls: [], insurances: [{ id: "i-1", kind: "liability", provider: "Foyer", policyNumber: "P-1", expiresOn: "2027-06-30" }], documents: [],
  periods: [period({ period: "2026-07" }), period({ period: "2026-08", allocatedCents: 167000, status: "partial_late" }), period({ period: "2026-09", allocatedCents: 0, status: "pending" })],
  ...over,
});
const request = (over: Partial<TenantRequest> = {}): TenantRequest => ({
  id: "t-1", ref: "INT-1", leaseId: "l-1", kind: "technical", category: "heating", severity: "urgent", status: "scheduled", state: "in_progress",
  title: "Chaudière en défaut", description: "", createdAt: "2026-08-19", updatedAt: "2026-08-21", closedAt: null, attachments: [], conversationId: "c-1",
  visit: { status: "scheduled", scheduledAt: "2026-08-28T08:00:00+02:00", artisanName: "Krier & Fils" }, ...over,
});

describe("what is owed now", () => {
  it("adds up what was due before today, oldest first, and leaves what is not due yet out", () => {
    const due = rentDue(lease(), TODAY);
    expect(due.lateCents).toBe(7000);
    expect(due.latePeriods.map((p) => p.period)).toEqual(["2026-08"]);
    // The day a rent falls due it is still to pay, not behind.
    expect(rentDue(lease(), "2026-08-01").lateCents).toBe(0);
    expect(rentDue(lease({ periods: [period({ period: "2026-06", allocatedCents: 0, status: "late" }), period({ period: "2026-08", allocatedCents: 0, status: "late" })] }), TODAY).latePeriods.map((p) => p.period)).toEqual(["2026-06", "2026-08"]);
  });

  it("names a standing order left at the old rent only when the payment matches it to the cent", () => {
    expect(rentDue(lease(), TODAY).staleOrder).toEqual({ paidCents: 167000, dueCents: 174000 });
    // Any other shortfall is not explained: the ledger does not say why.
    expect(rentDue(lease({ periods: [period({ period: "2026-08", allocatedCents: 160000, status: "partial_late" })] }), TODAY).staleOrder).toBeNull();
    expect(rentDue(lease({ previousRentCents: null }), TODAY).staleOrder).toBeNull();
    expect(rentDue(lease({ periods: [period({ period: "2026-08", allocatedCents: 0, status: "late" })] }), TODAY).staleOrder).toBeNull();
  });

  it("ignores a period written off", () => {
    expect(rentDue(lease({ periods: [period({ period: "2026-08", allocatedCents: 0, status: "written_off" })] }), TODAY).lateCents).toBe(0);
  });
});

describe("what there is to do, and what is coming", () => {
  const l = lease();
  const p: TenantPayments = paymentsOf(l, TODAY);

  it("keeps the late rent out of the to-do list: the rent block already says it", () => {
    expect(todoFor(l, p, TODAY)).toEqual([]);
    expect(todoFor(lease({ insurances: [] }), p, TODAY)).toEqual([{ kind: "insurance_missing" }]);
  });

  it("lists the dated things ahead in order, each from a row that carries its date", () => {
    const withEdl = lease({ endDate: "2026-12-31", edls: [{ id: "e-1", kind: "exit", status: "draft", scheduledAt: "2026-12-20", completedAt: null, keyHandoverAt: null, sealed: false }] });
    const up = upcomingFor(withEdl, paymentsOf(withEdl, TODAY), [request()], TODAY);
    expect(up.map((u) => u.kind)).toEqual(["visit", "rent", "edl", "lease_end"]);
    expect(up[0]).toMatchObject({ requestId: "t-1", artisanName: "Krier & Fils" });
    expect(up[1]).toMatchObject({ at: "2026-09-01", amountCents: 174000 });
  });

  it("shows no visit the database did not hand over, none in the past, none on a closed request", () => {
    expect(upcomingFor(l, p, [request({ visit: null })], TODAY).some((u) => u.kind === "visit")).toBe(false);
    expect(upcomingFor(l, p, [request({ visit: { status: "scheduled", scheduledAt: "2026-08-21T09:00:00", artisanName: null } })], TODAY).some((u) => u.kind === "visit")).toBe(false);
    expect(upcomingFor(l, p, [request({ state: "resolved", status: "done" })], TODAY).some((u) => u.kind === "visit")).toBe(false);
    expect(upcomingFor(l, p, [request({ leaseId: "l-other" })], TODAY).some((u) => u.kind === "visit")).toBe(false);
  });
});

describe("a request's path", () => {
  const states = (r: Partial<TenantRequest>) => requestTimeline(request(r)).map((s) => `${s.key}:${s.state}`);

  it("follows the ticket's own status", () => {
    expect(states({ status: "new", visit: null })).toEqual(["sent:now", "taken:todo", "visit:todo", "resolved:todo"]);
    expect(states({ status: "triaged", visit: null })).toEqual(["sent:done", "taken:now", "visit:todo", "resolved:todo"]);
    expect(states({ status: "scheduled" })).toEqual(["sent:done", "taken:done", "slot:done", "visit:now", "resolved:todo"]);
    expect(states({ status: "done", closedAt: "2026-08-29" })).toEqual(["sent:done", "taken:done", "slot:done", "visit:done", "resolved:now"]);
    expect(states({ status: "cancelled", closedAt: "2026-08-20" })).toEqual(["sent:done", "refused:now"]);
  });

  it("says the slot is confirmed only when the work order does, and never dates it", () => {
    const offered = { status: "accepted", scheduledAt: "2026-08-28T08:00:00+02:00", artisanName: null };
    expect(states({ status: "triaged", visit: offered })).toEqual(["sent:done", "taken:now", "visit:todo", "resolved:todo"]);
    expect(states({ status: "triaged", visit: null }).some((s) => s.startsWith("slot"))).toBe(false);
    expect(requestTimeline(request({ status: "scheduled" })).find((s) => s.key === "slot")?.at).toBeNull();
  });

  it("has no visit step for a question nobody will come for", () => {
    expect(states({ kind: "question", status: "triaged", visit: null })).toEqual(["sent:done", "taken:now", "resolved:todo"]);
  });

  it("dates a step only where a row carries the date", () => {
    const steps = requestTimeline(request({ status: "scheduled" }));
    expect(steps.find((s) => s.key === "sent")?.at).toBe("2026-08-19");
    expect(steps.find((s) => s.key === "taken")?.at).toBeNull();
    expect(steps.find((s) => s.key === "visit")?.at).toBe("2026-08-28T08:00:00+02:00");
    expect(steps.find((s) => s.key === "resolved")?.at).toBeNull();
    // Without the visit row, the step it is at carries the ticket's last update and nothing more precise.
    expect(requestTimeline(request({ status: "scheduled", visit: null })).find((s) => s.key === "visit")?.at).toBe("2026-08-21");
  });
});

describe("unread messages", () => {
  const conversation = (messages: Array<[string, boolean]>): TenantConversation => ({
    id: "c-1", leaseId: "l-1", label: "", lastMessageAt: messages[messages.length - 1]?.[0] ?? "",
    messages: messages.map(([sentAt, mine], i) => ({ id: `m-${i}`, senderKind: mine ? "tenant" : "manager", body: "", sentAt, mine, ticketId: null })),
  });
  const thread = conversation([["2026-08-19T08:15:00", true], ["2026-08-19T09:05:00", false], ["2026-08-21T16:40:00", false]]);

  it("counts what the other side wrote after the tenant's own last word", () => {
    expect(unreadCount([thread], {})).toBe(2);
    expect(unreadCount([conversation([["2026-08-19T09:05:00", false], ["2026-08-19T10:00:00", true]])], {})).toBe(0);
  });

  it("counts from the moment this browser last showed the conversation, when that is later", () => {
    expect(unreadCount([thread], { "l-1": "2026-08-19T12:00:00" })).toBe(1);
    expect(unreadCount([thread], { "l-1": "2026-08-21T16:40:00" })).toBe(0);
    // A mark for another tenancy changes nothing here.
    expect(unreadCount([thread], { "l-2": "2026-08-22T00:00:00" })).toBe(2);
  });

  it("keeps the seen marks in a cookie that survives a round trip and drops anything malformed", () => {
    const seen = { "l-1": "2026-08-21T16:40:00", "0b2d6c1e-7c1a-4a55-9d5e-1f2a3b4c5d6e": "2026-08-21T16:40:00.123456+00:00" };
    expect(parseSeen(serializeSeen(seen))).toEqual(seen);
    expect(parseSeen("l-1=not-a-date|<script>=2026-08-21T16:40:00|l-2=2026-08-21T16:40:00")).toEqual({ "l-2": "2026-08-21T16:40:00" });
    expect(parseSeen(undefined)).toEqual({});
    expect(parseSeen("%E0%A4%A")).toEqual({});
    expect(SEEN_COOKIE).toBe("morada_tenant_seen");
  });
});

describe("a visit's day and hour", () => {
  it("reads a zoned timestamp on Luxembourg's clock, whatever the server's", () => {
    expect(visitWhen("2026-08-28T06:00:00Z", "fr").time).toBe("08:00");
    expect(visitWhen("2026-12-04T07:30:00+00:00", "fr").time).toBe("08:30");
  });
  it("reads a timestamp without a zone as written", () => {
    expect(visitWhen("2026-08-21T09:00:00", "fr").time).toBe("09:00");
    expect(visitWhen("2026-08-21T09:00:00", "fr").date).toContain("21");
  });
});
