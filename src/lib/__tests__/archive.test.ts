import { beforeEach, describe, expect, it } from "vitest";
import type { OrgContext } from "@/lib/gestion/api";
import { closeLease } from "@/lib/gestion/lease";
import { buildPortfolio } from "@/lib/gestion/portfolio";
import { FakeDb } from "./helpers/fake-postgrest";
import { ORG, ctxFor, hydrate, isoToday, letTo, seedProperty } from "./helpers/tenancy";

/**
 * Archiving a property, read through the same hydration as the screens.
 *
 * The rule under test: a lot is on screen only while its property is, and no
 * lookup by id ever answers `undefined`. A property archived while its lots
 * kept `archived_at = null` (what the archive wrote before the base cascaded
 * it) must leave the workspace working, with its history still named.
 */

const today = isoToday();
const ANNA = { firstName: "Anna", lastName: "Weber", email: "anna.weber@example.lu" };

describe("an archived property", () => {
  let db: FakeDb;
  let ctx: OrgContext;

  beforeEach(() => {
    db = new FakeDb(today);
    ctx = ctxFor(db);
  });

  it("leaves every screen with its lots, even when the lots were not archived with it", async () => {
    const kept = seedProperty(db, ORG, "Maison Weber");
    const gone = seedProperty(db, ORG, "Studio Gare");
    db.table("properties").find((p) => p.id === gone.propertyId)!.archived_at = `${today}T09:00:00.000Z`;

    const demo = await hydrate(db);
    expect(demo.PROPERTIES.map((p) => p.id)).toEqual([kept.propertyId]);
    expect(demo.UNITS.map((u) => u.id)).toEqual([kept.unitId]);
    // What the shell builds on every page: a label per lot. It used to throw here.
    expect(demo.UNITS.map((u) => `${u.label} · ${demo.propertyById(u.propertyId).name}`)).toEqual(["Maison · Maison Weber"]);
    expect(buildPortfolio(demo).map((c) => c.property.id)).toEqual([kept.propertyId]);
    expect(demo.DEGRADED).toEqual([]);
  });

  it("is listed as archived, with what a restore brings back", async () => {
    const gone = seedProperty(db, ORG, "Studio Gare");
    db.insertRow("units", { org_id: ORG, property_id: gone.propertyId, label: "Cave", kind: "cellar" });
    db.table("properties").find((p) => p.id === gone.propertyId)!.archived_at = `${today}T09:00:00.000Z`;

    let demo = await hydrate(db);
    expect(demo.ARCHIVED_PROPERTIES).toEqual([
      { id: gone.propertyId, name: "Studio Gare", address: expect.stringContaining("Strassen"), type: "house", archivedOn: today, unitsCount: 2 },
    ]);

    // Restoring is the archive undone: the property and its lots are back.
    db.table("properties").find((p) => p.id === gone.propertyId)!.archived_at = null;
    demo = await hydrate(db);
    expect(demo.ARCHIVED_PROPERTIES).toEqual([]);
    expect(demo.PROPERTIES.map((p) => p.name)).toEqual(["Studio Gare"]);
    expect(demo.UNITS).toHaveLength(2);
  });

  it("keeps the names of its past tenancies: history outlives the archive", async () => {
    const start = `${Number(today.slice(0, 4)) - 1}${today.slice(4)}`;
    const { propertyId, unitId } = seedProperty(db, ORG, "Maison Weber");
    const rental = await letTo(ctx, unitId, [ANNA], "1 250", start);
    const closed = await closeLease(ctx, rental.leaseId, { endDate: today, depositOutcome: "release_pending", releasedCents: 0, keysReturned: true, decompteIssuedOn: null }, today);
    expect(closed).toMatchObject({ ok: true });
    db.table("properties").find((p) => p.id === propertyId)!.archived_at = `${today}T09:00:00.000Z`;
    db.table("units").find((u) => u.id === unitId)!.archived_at = `${today}T09:00:00.000Z`;

    const demo = await hydrate(db);
    expect(demo.PROPERTIES).toEqual([]);
    expect(demo.UNITS).toEqual([]);
    const lease = demo.LEASES.find((l) => l.id === rental.leaseId)!;
    expect(lease.status).toBe("ended");
    expect(demo.leaseUnitLabel(lease)).toBe("Maison · Maison Weber");
    expect(demo.unitById(lease.unitId).label).toBe("Maison");
    expect(demo.ENDED_LEASES).toEqual([{ id: rental.leaseId, label: "Maison · Maison Weber", tenant: "Anna Weber", rentCents: 125000 }]);
  });

  it("takes a dossier in preparation off the screens with its lot", async () => {
    const { propertyId, unitId } = seedProperty(db, ORG, "Maison Weber");
    db.insertRow("leases", { org_id: ORG, unit_id: unitId, status: "draft", start_date: today, rent_cents: 100000 });
    expect((await hydrate(db)).LEASES).toHaveLength(1);
    db.table("properties").find((p) => p.id === propertyId)!.archived_at = `${today}T09:00:00.000Z`;
    expect((await hydrate(db)).LEASES).toEqual([]);
  });

  it("answers an empty record, never undefined, for an id nothing carries", async () => {
    seedProperty(db, ORG, "Maison Weber");
    const demo = await hydrate(db);
    expect(demo.propertyById("nope")).toMatchObject({ id: "nope", name: "" });
    expect(demo.unitById("nope")).toMatchObject({ id: "nope", label: "" });
    expect(demo.contactById("nope")).toMatchObject({ id: "nope", name: "" });
    expect(demo.leaseById("nope")).toMatchObject({ id: "nope", status: "ended", tenantContactIds: [] });
  });

  it("leaves out the rows whose tenancy did not load, instead of failing on them", async () => {
    const { unitId } = seedProperty(db, ORG, "Maison Weber");
    await letTo(ctx, unitId, [ANNA]);
    expect((await hydrate(db)).RENT_PERIODS.length).toBeGreaterThan(0);
    // The leases read fails while the ledger's succeeds: one table missing from the answer.
    db.absent.add("leases");
    const demo = await hydrate(db);
    expect(demo.LEASES).toEqual([]);
    expect(demo.RENT_PERIODS).toEqual([]);
    expect(demo.DEPOSITS).toEqual([]);
  });
});
