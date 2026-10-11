import { describe, expect, it } from "vitest";
import { loanScopeProblem } from "@/lib/gestion/investment";
import { hasPerm } from "@/lib/gestion/api";
import { FakeDb } from "@/lib/__tests__/helpers/fake-postgrest";

/**
 * What a loan may name, and how a route asks for a permission. The loan's
 * foreign keys are single-column and are checked without the policies, so
 * the property and the lot are read under the caller's token, in the
 * active workspace, before the row is written. A permission is asked of
 * gestion.can and an unreadable answer is a no.
 */
const ORG = "0f0f0f0f-0000-4000-8000-0000000000aa";
const OTHER = "0f0f0f0f-0000-4000-8000-0000000000bb";

function seeded() {
  const db = new FakeDb(new Date().toISOString().slice(0, 10));
  const mine = db.insertRow("properties", { org_id: ORG, name: "Maison Weber", type: "house" });
  const mineToo = db.insertRow("properties", { org_id: ORG, name: "Résidence Beaulieu", type: "building" });
  const theirs = db.insertRow("properties", { org_id: OTHER, name: "Ailleurs", type: "house" });
  const lot = db.insertRow("units", { org_id: ORG, property_id: mine.id, label: "Maison" });
  const otherLot = db.insertRow("units", { org_id: ORG, property_id: mineToo.id, label: "Apt 3B" });
  const theirLot = db.insertRow("units", { org_id: OTHER, property_id: theirs.id, label: "Apt 1" });
  return { g: db.client(), db, mine: String(mine.id), theirs: String(theirs.id), lot: String(lot.id), otherLot: String(otherLot.id), theirLot: String(theirLot.id) };
}

describe("a loan's property and lot", () => {
  it("takes the workspace's own property, with or without one of its lots", async () => {
    const { g, mine, lot } = seeded();
    expect(await loanScopeProblem(g, ORG, mine, null)).toBeNull();
    expect(await loanScopeProblem(g, ORG, mine, lot)).toBeNull();
  });
  it("refuses another workspace's property or lot, and a lot of another property", async () => {
    const { g, mine, theirs, otherLot, theirLot } = seeded();
    expect(await loanScopeProblem(g, ORG, theirs, null)).toBe("property");
    expect(await loanScopeProblem(g, ORG, "no-such-id", null)).toBe("property");
    expect(await loanScopeProblem(g, ORG, mine, theirLot)).toBe("unit");
    expect(await loanScopeProblem(g, ORG, mine, otherLot)).toBe("unit");
  });
  it("says so when the register cannot be read", async () => {
    const { g, db, mine } = seeded();
    db.absent.add("properties");
    expect(await loanScopeProblem(g, ORG, mine, null)).toBe("storage");
  });
});

describe("a permission", () => {
  const reader = (answer: { data: unknown; error: { code: string; message: string } | null }) => {
    const calls: Array<{ name: string; args: unknown }> = [];
    return { calls, g: { rpc: async (name: string, args: unknown) => (calls.push({ name, args }), answer) } as unknown as Parameters<typeof hasPerm>[0] };
  };
  it("is asked of gestion.can for the workspace", async () => {
    const yes = reader({ data: true, error: null });
    expect(await hasPerm(yes.g, ORG, "gestion.finance.edit")).toBe(true);
    expect(yes.calls).toEqual([{ name: "can", args: { p_org: ORG, p_perm: "gestion.finance.edit" } }]);
    expect(await hasPerm(reader({ data: false, error: null }).g, ORG, "gestion.finance.edit")).toBe(false);
  });
  it("fails closed", async () => {
    expect(await hasPerm(reader({ data: null, error: { code: "PGRST202", message: "unknown" } }).g, ORG, "gestion.finance.edit")).toBe(false);
    expect(await hasPerm(reader({ data: "true", error: null }).g, ORG, "gestion.finance.edit")).toBe(false);
  });
});
