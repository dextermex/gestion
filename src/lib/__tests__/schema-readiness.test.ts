import { describe, expect, it } from "vitest";
import { FakeDb } from "./helpers/fake-postgrest";
import { ORG, hydrate, isoToday } from "./helpers/tenancy";

/**
 * Production carries the signature tables (0027) and the contract identity
 * columns (0028) only once they are approved and applied. Until then the
 * screens read what exists and offer nothing that would fail: no sending
 * without the sendings table, no identity editor without its columns.
 */
describe("what the screens offer before the migrations are applied", () => {
  it("offers sending only once the base carries the signature tables", async () => {
    const db = new FakeDb(isoToday());
    expect((await hydrate(db)).SIGNATURE_READY).toBe(true);
    db.absent.add("signature_envelopes");
    db.absent.add("signature_signers");
    const data = await hydrate(db);
    expect(data.SIGNATURE_READY).toBe(false);
    expect(data.SIGNATURE_ENVELOPES).toEqual([]);
  });

  it("offers the identity editor only once contacts carry the identity columns", async () => {
    const db = new FakeDb(isoToday());
    // A contact row as production reads it before 0028: no civility column at all.
    db.table("contacts").push({ id: "c-1", org_id: ORG, kind: "natural", first_name: "Anna", last_name: "Weber", display_name: "Anna Weber", email: null, phone: null, language: "fr", archived_at: null, created_at: `${isoToday()}T12:00:00.000Z` });
    const before = await hydrate(db);
    expect(before.IDENTITY_READY).toBe(false);
    expect(before.CONTACTS[0].identity).toBeUndefined();
    db.table("contacts")[0].civility = "f";
    const after = await hydrate(db);
    expect(after.IDENTITY_READY).toBe(true);
    expect(after.CONTACTS[0].identity).toMatchObject({ civility: "f", address: { country: "LU" } });
  });
});
