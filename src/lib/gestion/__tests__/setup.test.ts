import { describe, expect, it } from "vitest";
import { propertyTypeParam, setupFacts, setupHrefs, setupProgress, tourMode, tourSeenOn, withTourSeen } from "@/lib/gestion/setup";

type R = Parameters<typeof setupFacts>[0];
const lease = (id: string, unitId: string, status: string, seq = 1) => ({ id, unitId, status, seq }) as unknown as R["LEASES"][number];
const unit = (id: string, propertyId: string, kind = "dwelling") => ({ id, propertyId, kind }) as unknown as R["UNITS"][number];
const records = (over: Partial<R> = {}): R => ({ PROPERTIES: [], UNITS: [], LEASES: [], BANK_ACCOUNTS: [], INVITES: [], ...over }) as R;

describe("the five setup steps", () => {
  it("starts at one of five on an empty space, with the property next and the lease and invitation waiting", () => {
    const p = setupProgress(setupFacts(records()));
    expect(p.count).toBe(1);
    expect(p.total).toBe(5);
    expect(p.next).toBe("property");
    expect(p.locked).toEqual({ account: false, property: false, lease: true, bank: false, invite: true });
    expect(p.complete).toBe(false);
  });

  it("frees the lease once a property exists, the invitation once a lease runs", () => {
    const one = setupProgress({ property: true, lease: false, bank: false, invite: false });
    expect(one.count).toBe(2);
    expect(one.next).toBe("lease");
    expect(one.locked.lease).toBe(false);
    expect(one.locked.invite).toBe(true);
    const two = setupProgress({ property: true, lease: true, bank: false, invite: false });
    expect(two.next).toBe("bank");
    expect(two.locked.invite).toBe(false);
  });

  it("names the first open step in order even when a later one is done", () => {
    const p = setupProgress({ property: false, lease: false, bank: true, invite: false });
    expect(p.count).toBe(2);
    expect(p.next).toBe("property");
  });

  it("is complete with all five, and offers nothing next", () => {
    const p = setupProgress({ property: true, lease: true, bank: true, invite: true });
    expect(p.complete).toBe(true);
    expect(p.next).toBeNull();
  });

  it("reads the records: a draft is not a lease, a revoked invitation is not one", () => {
    const f = setupFacts(
      records({
        PROPERTIES: [{ id: "p1" }] as R["PROPERTIES"],
        LEASES: [lease("l1", "u1", "draft")],
        INVITES: [{ id: "i1", revokedAt: "2026-01-01" }] as R["INVITES"],
      }),
    );
    expect(f).toEqual({ property: true, lease: false, bank: false, invite: false });
    expect(setupFacts(records({ LEASES: [lease("l1", "u1", "notice")], INVITES: [{ id: "i", revokedAt: null }] as R["INVITES"] }))).toMatchObject({ lease: true, invite: true });
  });
});

describe("where each step starts", () => {
  it("sends the lease straight into the only vacant lot, and the invitation to the lease's tenant panel", () => {
    const h = setupHrefs(records({ PROPERTIES: [{ id: "p1" }] as R["PROPERTIES"], UNITS: [unit("u1", "p1")] }));
    expect(h.property).toBe("/app/biens/nouveau");
    expect(h.lease).toBe("/app/biens/locataire?lot=u1");
    expect(h.bank).toBe("/app/banque");
    expect(h.invite).toBe("/app/baux");
    const run = setupHrefs(records({ PROPERTIES: [{ id: "p1" }] as R["PROPERTIES"], UNITS: [unit("u1", "p1")], LEASES: [lease("l1", "u1", "active", 1), lease("l2", "u1", "ended", 2)] }));
    expect(run.invite).toBe("/app/baux/l1#espace-locataire");
  });

  it("resumes a dossier in preparation, and otherwise opens the property or the list", () => {
    expect(setupHrefs(records({ PROPERTIES: [{ id: "p1" }] as R["PROPERTIES"], UNITS: [unit("u1", "p1")], LEASES: [lease("d1", "u1", "draft", 1), lease("d2", "u1", "draft", 2)] })).lease).toBe("/app/biens/locataire?bail=d2");
    // Two vacant lots in one building: the building, where the person picks.
    expect(setupHrefs(records({ PROPERTIES: [{ id: "p1" }] as R["PROPERTIES"], UNITS: [unit("u1", "p1"), unit("u2", "p1")] })).lease).toBe("/app/biens/p1");
    // A parking space cannot carry a lease of its own.
    expect(setupHrefs(records({ PROPERTIES: [{ id: "p1" }, { id: "p2" }] as R["PROPERTIES"], UNITS: [unit("u1", "p1", "parking")] })).lease).toBe("/app/biens");
  });
});

describe("the tour's state on the account", () => {
  it("reads morada_mobile.tour and writes it without dropping the other keys", () => {
    expect(tourSeenOn(undefined)).toBe(false);
    expect(tourSeenOn({ morada_mobile: { tour: 0 } })).toBe(false);
    expect(tourSeenOn({ morada_mobile: { tour: 1 } })).toBe(true);
    const quiz = { units: "2to5" };
    expect(withTourSeen({ morada_mobile: { quiz, dashboard: ["cashflow"], trial_started_at: "2026-11-27" } })).toEqual({ quiz, dashboard: ["cashflow"], trial_started_at: "2026-11-27", tour: 1 });
    expect(withTourSeen({ morada_mobile: "broken" })).toEqual({ tour: 1 });
    expect(withTourSeen(null)).toEqual({ tour: 1 });
  });

  it("plays the full tour once, then the card once per newly completed step", () => {
    const base = { guide: true, complete: false, seenOnAccount: false, seenHere: false, lastCount: null, count: 1 };
    expect(tourMode(base)).toBe("full");
    expect(tourMode({ ...base, seenOnAccount: true })).toBe("off");
    expect(tourMode({ ...base, seenHere: true, lastCount: 1, count: 2 })).toBe("card");
    expect(tourMode({ ...base, seenHere: true, lastCount: 2, count: 2 })).toBe("off");
    expect(tourMode({ ...base, guide: false })).toBe("off");
    expect(tourMode({ ...base, complete: true, count: 5 })).toBe("off");
  });

  it("takes only the three kinds the sign-up asks about", () => {
    expect(propertyTypeParam("house")).toBe("house");
    expect(propertyTypeParam("parking")).toBeNull();
    expect(propertyTypeParam(null)).toBeNull();
  });
});
