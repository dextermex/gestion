/**
 * The tenants of record of a month: every tenant party in by its end and not
 * out before it began. A tenancy that ended keeps its people (they left on
 * its last day), so a mise en demeure on its arrears still names them.
 */
export function tenantsOfRecord(parties: Array<Record<string, unknown>>, month: string): string[] {
  const start = `${month.slice(0, 7)}-01`;
  const [y, m] = start.split("-").map(Number);
  const end = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  const day = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v.slice(0, 10) : null);
  return parties
    .filter((p) => p.role === "tenant" || p.role === "colocataire")
    .filter((p) => (day(p.moved_in_on) ?? start) <= end && (day(p.moved_out_on) ?? end) >= start)
    .sort((a, b) => String(day(a.moved_in_on) ?? "").localeCompare(String(day(b.moved_in_on) ?? "")) || String(a.id).localeCompare(String(b.id)))
    .map((p) => String(p.contact_id))
    .filter((id, i, all) => all.indexOf(id) === i);
}
