import { afterEach, describe, expect, it, vi } from "vitest";
import { buildRealDataFrom, type GestionReader } from "@/lib/demo/data-real";
import { orgFromWorkspace } from "@/lib/demo/data-empty";
import { buildTenantSpace } from "@/lib/portal/tenant-space";
import { FakeDb } from "./helpers/fake-postgrest";
import { ORG, isoToday, seedProperty } from "./helpers/tenancy";

/**
 * A read that fails is not an empty account. The management space's data
 * names the tables it could not read (the shell then says the screen may be
 * incomplete); a table the database does not carry yet is a feature not
 * there, not a failure; the tenant's space carries the same flag.
 */
type Failure = { code: string; message: string };

/** Every query on `table` fails as PostgREST would, whatever the builder calls made on it. */
function failing(g: GestionReader, table: string, error: Failure): GestionReader {
  const refused: Record<string, unknown> = {};
  const chain = new Proxy(refused, {
    get(_t, prop) {
      if (prop === "then") return (resolve: (v: unknown) => void) => resolve({ data: null, error, count: null });
      return () => chain;
    },
  });
  return new Proxy(g as object, {
    get(target, prop, receiver) {
      if (prop === "from") return (name: string) => (name === table ? chain : (target as GestionReader).from(name));
      const value = Reflect.get(target, prop, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as GestionReader;
}

const org = orgFromWorkspace({ id: ORG, name: "Cabinet Test", kind: "owner" });

describe("the management space's read", () => {
  afterEach(() => vi.restoreAllMocks());

  it("names nothing when every table was read", async () => {
    const db = new FakeDb(isoToday());
    seedProperty(db);
    const data = await buildRealDataFrom(db.client(), org, async () => new Map());
    expect(data.DEGRADED).toEqual([]);
    expect(data.PROPERTIES).toHaveLength(1);
  });

  it("names the table whose read failed, instead of passing its emptiness off as the account's", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const db = new FakeDb(isoToday());
    seedProperty(db);
    const data = await buildRealDataFrom(failing(db.client(), "properties", { code: "57014", message: "canceling statement due to statement timeout" }), org, async () => new Map());
    expect(data.PROPERTIES).toHaveLength(0);
    expect(data.DEGRADED).toEqual(["properties"]);
  });

  it("does not count a table the database does not carry yet", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const db = new FakeDb(isoToday());
    seedProperty(db);
    const data = await buildRealDataFrom(failing(db.client(), "template_validations", { code: "PGRST205", message: "Could not find the table" }), org, async () => new Map());
    expect(data.DEGRADED).toEqual([]);
  });
});

describe("the tenant's space", () => {
  afterEach(() => vi.restoreAllMocks());

  const reader = (failOn: string | null): GestionReader => {
    const rows = { in: () => rows, eq: () => rows, order: () => rows, limit: async () => ({ data: [], error: null }) };
    return {
      rpc: async (name: string) => (name === failOn ? { data: null, error: { code: "57014", message: "timeout" } } : name === "my_visits" ? { data: null, error: { code: "PGRST202", message: "absent" } } : { data: [], error: null }),
      from: () => ({ select: () => rows }),
    } as unknown as GestionReader;
  };
  const build = (g: GestionReader) => buildTenantSpace(g, { userId: "u-t", email: "t@example.test", displayName: "Jean Muller", today: "2026-08-23", sign: async () => new Map() });

  it("is whole when its doors answered", async () => {
    expect((await build(reader(null))).degraded).toBe(false);
  });

  it("says it may be incomplete when a door failed: no tenancy shown is then not proof of none", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const space = await build(reader("my_home"));
    expect(space.current).toBeNull();
    expect(space.degraded).toBe(true);
  });
});
