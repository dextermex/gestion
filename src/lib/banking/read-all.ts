import "server-only";

/**
 * Every row a filtered read answers, however many. PostgREST serves a page
 * (1 000 rows on the hosted default) and says nothing when more exist, so a
 * workspace-wide read used for money is paged until the exact count the
 * database gives is reached, in an order no two rows share.
 */

type Row = Record<string, unknown>;
export type ReadQuery = {
  eq(column: string, value: unknown): ReadQuery;
  in(column: string, values: unknown[]): ReadQuery;
  order(column: string, opts?: { ascending?: boolean }): ReadQuery;
  range(from: number, to: number): PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null; count?: number | null }>;
};
type Db = { from: (table: string) => { select: (columns: string, opts?: { count?: "exact" }) => unknown } };

const PAGE = 1000;
const CEILING = 100000;

export async function readAll(
  g: Db,
  table: string,
  columns: string,
  apply: (q: ReadQuery) => ReadQuery,
  key = "id",
): Promise<{ rows: Row[]; error: { code?: string; message?: string } | null }> {
  const rows: Row[] = [];
  let total = Infinity;
  while (rows.length < total && rows.length < CEILING) {
    const { data, error, count } = await apply(g.from(table).select(columns, { count: "exact" }) as ReadQuery)
      .order(key)
      .range(rows.length, rows.length + PAGE - 1);
    if (error) return { rows: [], error };
    const page = (data as Row[] | null) ?? [];
    if (typeof count === "number") total = count;
    rows.push(...page);
    if (page.length === 0) break;
    if (typeof count !== "number" && page.length < PAGE) break;
  }
  return { rows, error: null };
}
