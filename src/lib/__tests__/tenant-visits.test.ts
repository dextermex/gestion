import { describe, expect, it, vi } from "vitest";
import type { GestionReader } from "@/lib/demo/data-real";
import { buildTenantSpace } from "@/lib/portal/tenant-space";

/**
 * The planned visit on a request comes through `gestion.my_visits()`
 * (0029), a door production opens only once the migration is applied.
 * Before that the space is read exactly as it was and shows no visit;
 * after, it shows the date, the status and the contractor's name, and only
 * for the tenant's own requests whatever the function hands back.
 */
type Row = Record<string, unknown>;

const HOME: Row = {
  lease_id: "l-1", org_id: "o-1", unit_id: "u-1", property_id: "p-1", lease_status: "active", lease_type: "residential", start_date: "2023-04-01", end_date: null,
  rent_cents: 152000, charges_cents: 22000, charges_regime: "advances", payment_day: 1, rf_reference: "RF1", unit_label: "Apt 3B", property_name: "Résidence Beaulieu",
};
const TICKET: Row = { id: "t-1", lease_id: "l-1", category: "heating", severity: "urgent", status: "scheduled", title: "Chaudière", description: "", created_at: "2026-08-19T08:12:00Z", updated_at: "2026-08-21T16:40:00Z", closed_at: null };

function reader(opts: { visits?: Row[] | "absent" }): { g: GestionReader; rpc: ReturnType<typeof vi.fn> } {
  const tables: Record<string, Row[]> = { tickets: [TICKET] };
  const chain = (rows: Row[]) => {
    const q = { in: () => q, eq: () => q, order: () => q, limit: async () => ({ data: rows, error: null }) };
    return q;
  };
  const rpc = vi.fn(async (name: string) => {
    if (name === "my_home") return { data: [HOME], error: null };
    if (name === "my_visits") {
      if (opts.visits === "absent" || opts.visits === undefined) return { data: null, error: { code: "PGRST202", message: "Could not find the function gestion.my_visits" } };
      return { data: opts.visits, error: null };
    }
    return { data: [], error: null };
  });
  const g = { rpc, from: (table: string) => ({ select: () => chain(tables[table] ?? []) }) } as unknown as GestionReader;
  return { g, rpc };
}
const build = (g: GestionReader) => buildTenantSpace(g, { userId: "u-tenant", email: "jean@example.test", displayName: "Jean Muller", today: "2026-08-23", sign: async () => new Map() });

describe("the planned visit on a tenant's request", () => {
  it("is absent, without a word in the logs, while the migration is not applied", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const { g, rpc } = reader({ visits: "absent" });
    const space = await build(g);
    expect(rpc).toHaveBeenCalledWith("my_visits");
    expect(space.requests).toHaveLength(1);
    expect(space.requests[0].visit).toBeNull();
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
  });

  it("carries the date, the status and the contractor once the function answers", async () => {
    const { g } = reader({ visits: [{ ticket_id: "t-1", status: "scheduled", scheduled_at: "2026-08-28T06:00:00+00:00", artisan_name: "Krier & Fils" }] });
    expect((await build(g)).requests[0].visit).toEqual({ status: "scheduled", scheduledAt: "2026-08-28T06:00:00+00:00", artisanName: "Krier & Fils" });
  });

  it("keeps the latest planned visit of a request, and nothing for a request that is not the tenant's", async () => {
    const { g } = reader({
      visits: [
        { ticket_id: "t-1", status: "scheduled", scheduled_at: "2026-09-02T08:00:00+00:00", artisan_name: null },
        { ticket_id: "t-1", status: "done", scheduled_at: "2026-08-21T07:00:00+00:00", artisan_name: "Krier & Fils" },
        { ticket_id: "t-someone-else", status: "scheduled", scheduled_at: "2026-08-30T08:00:00+00:00", artisan_name: "X" },
        { ticket_id: "t-1", status: "scheduled", scheduled_at: null, artisan_name: "No date" },
      ],
    });
    const space = await build(g);
    expect(space.requests[0].visit).toEqual({ status: "scheduled", scheduledAt: "2026-09-02T08:00:00+00:00", artisanName: null });
  });

  it("does not ask for visits when the tenant has no request", async () => {
    const { g, rpc } = reader({ visits: [] });
    (g as unknown as { from: (t: string) => unknown }).from = () => ({ select: () => ({ in: function () { return this; }, eq: function () { return this; }, order: function () { return this; }, limit: async () => ({ data: [], error: null }) }) });
    await build(g);
    expect(rpc).not.toHaveBeenCalledWith("my_visits");
  });
});
