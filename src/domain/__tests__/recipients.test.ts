import { describe, expect, it } from "vitest";
import { tenantsOfRecord } from "@/domain/arrears/recipients";

/** Who a letter about a month's rent goes to: every tenant of record of that month. */
describe("the tenants of record of a month", () => {
  const parties = [
    { id: "1", contact_id: "anna", role: "tenant", moved_in_on: "2024-01-01", moved_out_on: null },
    { id: "2", contact_id: "luc", role: "tenant", moved_in_on: "2024-01-01", moved_out_on: "2026-03-15" },
    { id: "3", contact_id: "nora", role: "colocataire", moved_in_on: "2026-04-01", moved_out_on: null },
    { id: "4", contact_id: "paul", role: "guarantor", moved_in_on: "2024-01-01", moved_out_on: null },
  ];
  it("keeps whoever was in during the month, and only tenants", () => {
    expect(tenantsOfRecord(parties, "2026-03-01")).toEqual(["anna", "luc"]);
    expect(tenantsOfRecord(parties, "2026-04")).toEqual(["anna", "nora"]);
    expect(tenantsOfRecord(parties, "2023-12-01")).toEqual([]);
  });
  it("still names the people of a tenancy that ended", () => {
    const ended = parties.map((p) => ({ ...p, moved_out_on: p.moved_out_on ?? "2026-06-30" }));
    expect(tenantsOfRecord(ended, "2026-06")).toEqual(["anna", "nora"]);
  });
});
