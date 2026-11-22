import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

/**
 * What a route answers: "ok" only for a row that changed, a refusal in
 * words for a role that may not, "invalid" for a request that cannot be
 * right (an id that is not one, a day that does not exist, an amount past
 * what a row holds), and never an exception on a body it did not expect.
 */
vi.mock("next/headers", () => ({ headers: async () => new Headers({ host: "app.morada.lu", "x-forwarded-proto": "https", origin: "https://app.morada.lu" }) }));
vi.mock("@/lib/supabase/server", () => ({ getSession: vi.fn(), authedClient: vi.fn() }));
vi.mock("@/lib/workspace", () => ({ getIdentity: vi.fn() }));
vi.mock("@/lib/billing/gate", () => ({ refuseWhenLocked: vi.fn(async () => null) }));

import { DELETE as deletePolicy, PATCH as patchPolicy } from "@/app/api/assurances/[id]/route";
import { POST as createPolicy } from "@/app/api/assurances/create/route";
import { POST as recordReading } from "@/app/api/compteurs/[id]/releves/route";
import { POST as createMeter } from "@/app/api/compteurs/create/route";
import { PATCH as patchContact } from "@/app/api/contacts/[id]/route";
import { PATCH as patchLetter } from "@/app/api/lettres/[id]/route";
import { PATCH as saveSettings } from "@/app/api/reglages/route";
import { csvDocument, csvEuros } from "@/lib/fiscal/csv";
import { dbError, isUuid, isoDay, jsonBody } from "@/lib/gestion/api";
import { MAX_CENTS, parseEuroInput } from "@/lib/gestion/euros";
import { authedClient, getSession } from "@/lib/supabase/server";
import { getIdentity } from "@/lib/workspace";

const ORG = { id: "0b7e3c1a-4d55-4f0e-9a41-2f5d8c6b7a10", name: "Cabinet", kind: "manager", role: "manager" };
const ID = "5c1d2e3f-0a1b-4c2d-8e3f-4a5b6c7d8e9f";
type Row = Record<string, unknown>;
type Answer = { data: Row[] | null; error: { code: string; message?: string } | null };

/** A table that answers what the test says, and remembers what was asked of it. */
let permissions: Set<string>;
let answers: Record<string, Answer>;
let calls: Array<{ table: string; op: string; values?: unknown; filters: Row }>;
function gestion() {
  const from = (table: string) => {
    const call = { table, op: "select", values: undefined as unknown, filters: {} as Row };
    calls.push(call);
    const answer = (): Answer => answers[`${table}.${call.op}`] ?? answers[table] ?? { data: [], error: null };
    const q = {
      select: () => q,
      insert: (values: unknown) => ((call.op = "insert"), (call.values = values), q),
      update: (values: unknown) => ((call.op = "update"), (call.values = values), q),
      delete: () => ((call.op = "delete"), q),
      eq: (k: string, v: unknown) => ((call.filters[k] = v), q),
      in: () => q,
      maybeSingle: async () => ({ data: answer().data?.[0] ?? null, error: answer().error }),
      single: async () => ({ data: answer().data?.[0] ?? null, error: answer().error }),
      then: (resolve: (v: unknown) => unknown) => Promise.resolve(answer()).then(resolve),
    };
    return q;
  };
  const rpc = async (fn: string, args: Row) => (fn === "can" ? { data: permissions.has(String(args.p_perm)), error: null } : { data: true, error: null });
  return { from, rpc };
}
const send = (method: string, body?: unknown) => new NextRequest("https://app.morada.lu/api/x", { method, headers: { origin: "https://app.morada.lu", "Content-Type": "application/json" }, body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body) });
const at = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  permissions = new Set(["gestion.properties.edit", "gestion.tenants.edit", "gestion.leases.edit", "gestion.finance.edit", "gestion.settings.edit"]);
  answers = {};
  calls = [];
  vi.mocked(getSession).mockResolvedValue({ userId: "user-1", email: "anne@example.lu", accessToken: "token" });
  vi.mocked(getIdentity).mockResolvedValue({ userId: "user-1", email: "anne@example.lu", displayName: "Anne", workspaces: [ORG], active: ORG });
  vi.mocked(authedClient).mockReturnValue({ schema: () => gestion() } as never);
});

describe("the shared readers", () => {
  it("map a request the database cannot store to 400, a pending schema to 503, a refusal to 403, and the rest to 502", async () => {
    for (const code of ["22P02", "22003", "22007", "22008"]) expect(dbError("x", { code }).status, code).toBe(400);
    for (const code of ["PGRST205", "PGRST204", "42P01", "42703"]) {
      const res = dbError("x", { code });
      expect(res.status, code).toBe(503);
      expect(await res.json()).toEqual({ error: "schema_outdated" });
    }
    expect(dbError("x", { code: "42501" }).status).toBe(403);
    expect(dbError("x", { code: "PGRST106" }).status).toBe(503);
    expect(dbError("x", { code: "57014", message: "timeout" }).status).toBe(502);
    expect(dbError("x", null).status).toBe(502);
  });

  it("know a record id and a real day", () => {
    expect(isUuid(ID)).toBe(true);
    for (const v of ["", "1", "5c1d2e3f-0a1b-4c2d-8e3f", `${ID}'`, `${ID} or 1=1`, null, 7]) expect(isUuid(v), String(v)).toBe(false);
    expect(isoDay("2026-02-28")).toBe("2026-02-28");
    expect(isoDay("2024-02-29")).toBe("2024-02-29");
    for (const v of ["2026-02-30", "2026-13-01", "2026-00-10", "26-01-01", "2026-1-1", "2026-01-01T10:00", "", null, 20260101]) expect(isoDay(v), String(v)).toBeNull();
  });

  it("read any body without throwing", async () => {
    expect(await jsonBody(send("POST", { a: 1 }))).toEqual({ a: 1 });
    for (const raw of ["null", "[1,2]", '"text"', "7", "{not json", ""]) expect(await jsonBody(send("POST", raw)), raw).toEqual({});
    expect(await jsonBody(send("POST"))).toEqual({});
  });

  it("refuse an amount no row can hold", () => {
    expect(parseEuroInput("21474836,47")).toBe(MAX_CENTS);
    expect(parseEuroInput("21474836,48")).toBeNull();
    expect(parseEuroInput("999999999999")).toBeNull();
    expect(parseEuroInput("1 850,50")).toBe(185050);
  });

  it("write a typed name as text in a spreadsheet, and leave figures alone", () => {
    const out = csvDocument([["=HYPERLINK(1)", "+352 621", "-x", "@cmd", csvEuros(-1250), "-12", 5, "Résidence Beaulieu"]]);
    expect(out).toContain("'=HYPERLINK(1);'+352 621;'-x;'@cmd;-12,50;-12;5;Résidence Beaulieu");
  });
});

describe("an insurance policy", () => {
  it("is deleted only when a row was: none matched is not found", async () => {
    answers["insurance_policies.delete"] = { data: [{ id: ID }], error: null };
    expect((await deletePolicy(send("DELETE"), at(ID))).status).toBe(200);
    answers["insurance_policies.delete"] = { data: [], error: null };
    const res = await deletePolicy(send("DELETE"), at(ID));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
  });

  it("is refused in words to a role that may not edit, before anything is asked of the table", async () => {
    permissions = new Set(["gestion.properties.view"]);
    for (const res of [await deletePolicy(send("DELETE"), at(ID)), await patchPolicy(send("PATCH", { provider: "Foyer" }), at(ID)), await createPolicy(send("POST", { provider: "Foyer" }))]) {
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: "forbidden", permission: "gestion.properties.edit" });
    }
    expect(calls).toEqual([]);
  });

  it("is not found under a malformed id, without asking the database", async () => {
    expect((await deletePolicy(send("DELETE"), at("1 or 1=1"))).status).toBe(404);
    expect((await patchPolicy(send("PATCH", { provider: "Foyer" }), at("abc"))).status).toBe(404);
    expect(calls).toEqual([]);
  });

  it("refuses a premium that is not an amount, a day that does not exist and an unknown kind, instead of storing something else", async () => {
    answers["insurance_policies.update"] = { data: [{ id: ID }], error: null };
    expect((await patchPolicy(send("PATCH", { premium: "abc" }), at(ID))).status).toBe(400);
    expect((await patchPolicy(send("PATCH", { premium: "99999999999" }), at(ID))).status).toBe(400);
    expect((await patchPolicy(send("PATCH", { expiresOn: "2026-02-30" }), at(ID))).status).toBe(400);
    expect((await patchPolicy(send("PATCH", { kind: "poem" }), at(ID))).status).toBe(400);
    expect((await patchPolicy(send("PATCH", "null"), at(ID))).status).toBe(400);
    expect(calls.filter((c) => c.op === "update")).toEqual([]);
    // What is right is written as it was typed; an emptied date is cleared.
    expect((await patchPolicy(send("PATCH", { premium: "1 250,50", expiresOn: "", kind: "pno" }), at(ID))).status).toBe(200);
    expect(calls.find((c) => c.op === "update")?.values).toEqual({ premium_cents: 125050, expires_on: null, kind: "pno" });

    expect((await createPolicy(send("POST", { provider: "Foyer", kind: "poem" }))).status).toBe(400);
    expect((await createPolicy(send("POST", { provider: "Foyer", expiresOn: "2026-02-30" }))).status).toBe(400);
    expect((await createPolicy(send("POST", { provider: "Foyer", propertyId: "not-an-id" }))).status).toBe(400);
    expect((await createPolicy(send("POST", { provider: "Foyer", startsOn: "2026-06-01", expiresOn: "2026-01-01" }))).status).toBe(400);
  });
});

describe("a registered letter", () => {
  it("takes its answer only while it is still on its way: the status read is part of the write", async () => {
    answers["registered_letters.select"] = { data: [{ id: ID, status: "dispatched", dispatched_on: "2026-01-10" }], error: null };
    answers["registered_letters.update"] = { data: [{ id: ID }], error: null };
    expect((await patchLetter(send("PATCH", { arReceivedOn: "2026-01-12" }), at(ID))).status).toBe(200);
    expect(calls.find((c) => c.op === "update")?.filters).toMatchObject({ id: ID, org_id: ORG.id, status: "dispatched" });
    // Another answer landed in between: nothing changed here, and the route says so.
    answers["registered_letters.update"] = { data: [], error: null };
    const late = await patchLetter(send("PATCH", { arReceivedOn: "2026-01-12" }), at(ID));
    expect(late.status).toBe(409);
    expect(await late.json()).toEqual({ error: "already" });
    expect((await patchLetter(send("PATCH", { arReceivedOn: "2026-02-30" }), at(ID))).status).toBe(400);
  });
});

describe("a meter and its readings", () => {
  it("refuse a kind the register does not know, a figure out of range and a day that cannot be", async () => {
    expect((await createMeter(send("POST", { kind: "steam", serial: "A1", target: ID }))).status).toBe(400);
    expect((await createMeter(send("POST", { kind: "gas", serial: "A1", target: "common-nope" }))).status).toBe(400);
    answers["meters.select"] = { data: [{ id: ID }], error: null };
    for (const body of [{ value: "" }, { value: "-1" }, { value: "1e12" }, { value: "12", readOn: "2026-02-30" }, { value: "12", readOn: "2099-01-01" }, { value: "12", source: "guess" }]) {
      expect((await recordReading(send("POST", body), at(ID))).status, JSON.stringify(body)).toBe(400);
    }
    expect((await recordReading(send("POST", { value: "1 234,5" }), at(ID))).status).toBe(200);
    expect((calls.find((c) => c.op === "insert")?.values as Row).value).toBe(1234.5);
  });
});

describe("a contact", () => {
  it("keeps an address that is one and an account whose checksum holds", async () => {
    answers["contacts.update"] = { data: [{ id: ID }], error: null };
    const badMail = await patchContact(send("PATCH", { email: "jean@" }), at(ID));
    expect(badMail.status).toBe(400);
    expect(await badMail.json()).toEqual({ error: "invalid", field: "email" });
    const badIban = await patchContact(send("PATCH", { iban: "LU28 0019 4006 4475 0001" }), at(ID));
    expect(await badIban.json()).toEqual({ error: "invalid", field: "iban" });
    expect((await patchContact(send("PATCH", { birthDate: "1990-02-30" }), at(ID))).status).toBe(400);
    expect((await patchContact(send("PATCH", { email: "Jean@Example.lu", iban: "LU28 0019 4006 4475 0000" }), at(ID))).status).toBe(200);
    expect(calls.find((c) => c.op === "update")?.values).toMatchObject({ email: "jean@example.lu", iban: "LU280019400644750000" });
  });
});

describe("the settings", () => {
  it("answer a role that may not edit them with a refusal, not with a save that finds nothing", async () => {
    permissions = new Set(["gestion.properties.edit", "gestion.leases.edit"]);
    const res = await saveSettings(send("PATCH", { legalName: "Cabinet" }));
    expect(res).toBeInstanceOf(NextResponse);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "forbidden", permission: "gestion.settings.edit" });
    expect(calls).toEqual([]);
  });
});
