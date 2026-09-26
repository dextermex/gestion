import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  SaltEdgeError,
  createConnectSession,
  demoProviderCode,
  demoSnapshot,
  ensureCustomer,
  fakeProvidersWanted,
  registerCustomer,
  returnToFor,
  saltEdgeConfigured,
} from "@/lib/banking/saltedge";

const ok = (body: unknown) =>
  ({ ok: true, status: 200, statusText: "OK", json: async () => body }) as Response;
const ko = (status: number, body: unknown) =>
  ({ ok: false, status, statusText: "Error", json: async () => body }) as Response;

describe("saltedge client", () => {
  beforeEach(() => {
    vi.stubEnv("SALTEDGE_APP_ID", "app-id");
    vi.stubEnv("SALTEDGE_SECRET", "secret");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("is unconfigured without both environment variables", () => {
    expect(saltEdgeConfigured()).toBe(true);
    vi.stubEnv("SALTEDGE_SECRET", "");
    expect(saltEdgeConfigured()).toBe(false);
  });

  it("creates a customer and returns its id, whichever field v6 or v5 puts it in", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(ok({ data: { customer_id: "cust-1", identifier: "morada-u1" } }))
      .mockResolvedValueOnce(ok({ data: { id: "cust-2", identifier: "morada-u2" } }))
      .mockResolvedValueOnce(ok({ data: { identifier: "morada-u3", secret: "s" } }));
    await expect(ensureCustomer("morada-u1")).resolves.toBe("cust-1");
    await expect(ensureCustomer("morada-u2")).resolves.toBe("cust-2");
    // No id at all: said as such, with the field names only.
    await expect(ensureCustomer("morada-u3")).rejects.toMatchObject({ code: "CustomerIdMissing", message: expect.stringContaining("identifier, secret") });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("https://www.saltedge.com/api/v6/customers");
    expect(init?.method).toBe("POST");
    const headers = init?.headers as Record<string, string>;
    expect(headers["App-id"]).toBe("app-id");
    expect(headers.Secret).toBe("secret");
    expect(JSON.parse(String(init?.body))).toEqual({ data: { identifier: "morada-u1" } });
  });

  it("recovers an existing customer through the paginated list", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(ko(409, { error: { class: "DuplicatedCustomer", message: "exists" } }))
      .mockResolvedValueOnce(
        ok({ data: [{ id: "a", identifier: "other" }], meta: { next_id: "a" } }),
      )
      .mockResolvedValueOnce(
        ok({ data: [{ customer_id: "cust-9", identifier: "morada-u1" }], meta: { next_id: null } }),
      );
    await expect(ensureCustomer("morada-u1")).resolves.toBe("cust-9");
  });

  it("registers a customer and takes an existing one as done", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(ok({ data: { customer_id: "cust-1", identifier: "morada-ws-1" } }))
      .mockResolvedValueOnce(ko(409, { error: { class: "DuplicatedCustomer", message: "exists" } }))
      .mockResolvedValueOnce(ko(401, { error: { class: "WrongSecret", message: "nope" } }));
    await expect(registerCustomer("morada-ws-1")).resolves.toBeUndefined();
    await expect(registerCustomer("morada-ws-1")).resolves.toBeUndefined();
    await expect(registerCustomer("morada-ws-1")).rejects.toMatchObject({ code: "WrongSecret" });
    // Registration is one call each time: no list walk, nothing else.
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("builds the return address on the deployment's origin, without a query", () => {
    expect(returnToFor("https://app.morada.lu")).toBe("https://app.morada.lu/app/banque/retour");
    expect(returnToFor("http://localhost:3000")).toBe("http://localhost:3000/app/banque/retour");
  });

  it("propagates provider errors with their class", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      ko(400, { error: { class: "ConnectionFailed", message: "nope" } }),
    );
    await expect(ensureCustomer("morada-u1")).rejects.toMatchObject({
      name: "SaltEdgeError",
      code: "ConnectionFailed",
    });
  });

  it("opens a connect session and returns the consent URL", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(ok({ data: { connect_url: "https://connect.example/x" } }));
    await expect(
      createConnectSession("morada-ws-1", "https://app.morada.lu/app/banque/retour", "fr"),
    ).resolves.toBe("https://connect.example/x");
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    // v6 takes the customer by the identifier we gave it, not by its id.
    expect(body.data.customer_identifier).toBe("morada-ws-1");
    expect(body.data.customer_id).toBeUndefined();
    expect(body.data.consent.scopes).toEqual(["accounts", "transactions"]);
    expect(body.data.attempt.return_to).toBe("https://app.morada.lu/app/banque/retour");
    expect(body.data.attempt.locale).toBe("fr");
    // A live app lists real banks only: no provider object leaves unless asked.
    expect(body.data.provider).toBeUndefined();
    expect(body.data.include_fake_providers).toBeUndefined();
    expect(body.data.provider_code).toBeUndefined();
  });

  it("lists the fake banks and opens on one provider when asked", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(ok({ data: { connect_url: "https://connect.example/demo" } }));
    await expect(
      createConnectSession("morada-demo-u1", "https://app.morada.lu/app/banque/retour", "en", {
        includeFakeProviders: true,
        providerCode: "fakebank_simple_xf",
      }),
    ).resolves.toBe("https://connect.example/demo");
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    // v6 groups them under `provider`; the flat v5 keys are refused.
    expect(body.data.provider).toEqual({ include_fake_providers: true, code: "fakebank_simple_xf" });
    expect(body.data.include_fake_providers).toBeUndefined();
    expect(body.data.provider_code).toBeUndefined();
    expect(body.data.consent.scopes).toEqual(["accounts", "transactions"]);
  });

  it("reads the fake-bank switch and the demo provider from the environment", () => {
    vi.stubEnv("SALTEDGE_FAKE_PROVIDERS", "");
    expect(fakeProvidersWanted()).toBe(false);
    for (const v of ["1", "true", "YES"]) {
      vi.stubEnv("SALTEDGE_FAKE_PROVIDERS", v);
      expect(fakeProvidersWanted()).toBe(true);
    }
    vi.stubEnv("SALTEDGE_FAKE_PROVIDERS", "0");
    expect(fakeProvidersWanted()).toBe(false);

    vi.stubEnv("SALTEDGE_DEMO_PROVIDER", "");
    expect(demoProviderCode()).toBe("fakebank_simple_xf");
    vi.stubEnv("SALTEDGE_DEMO_PROVIDER", " fakebank_oauth_xf ");
    expect(demoProviderCode()).toBe("fakebank_oauth_xf");
  });

  it("reads the demo journey's latest connection back, storing nothing", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      // The demo customer already exists: found again through the list.
      .mockResolvedValueOnce(ko(409, { error: { class: "DuplicatedCustomer", message: "exists" } }))
      .mockResolvedValueOnce(ok({ data: [{ id: "c-demo", identifier: "morada-demo-u1" }], meta: { next_id: null } }))
      // Two journeys ran; the latest one is read.
      .mockResolvedValueOnce(
        ok({
          data: [
            { id: "1", provider_name: "Fake Bank Simple", status: "active", last_success_at: null },
            { id: "2", provider_name: "Fake Bank Simple", status: "active", last_success_at: "2026-09-26T10:00:00Z" },
          ],
          meta: { next_id: null },
        }),
      )
      .mockResolvedValueOnce(
        ok({
          data: [
            { id: "a1", connection_id: "2", name: "Fake account 1", balance: 1234.5, currency_code: "EUR", extra: { iban: "LU12 0000 0000 0000 0001" } },
          ],
          meta: { next_id: null },
        }),
      )
      .mockResolvedValueOnce(
        ok({
          data: [
            { id: "t1", account_id: "a1", made_on: "2026-09-01", amount: -10, currency_code: "EUR", description: "x" },
            { id: "t2", account_id: "a1", made_on: "2026-09-02", amount: 20, currency_code: "EUR", description: "y" },
          ],
          meta: { next_id: null },
        }),
      );
    await expect(demoSnapshot("morada-demo-u1")).resolves.toEqual({
      provider: "Fake Bank Simple",
      accounts: [
        { id: "a1", name: "Fake account 1", iban: "LU12 0000 0000 0000 0001", balance: 1234.5, currency: "EUR", transactions: 2 },
      ],
    });
    const urls = fetchMock.mock.calls.map(([u]) => String(u));
    expect(urls[2]).toBe("https://www.saltedge.com/api/v6/connections?customer_id=c-demo");
    expect(urls[3]).toBe("https://www.saltedge.com/api/v6/accounts?connection_id=2");
    expect(urls[4]).toBe("https://www.saltedge.com/api/v6/transactions?connection_id=2&account_id=a1");
    // Reads only: nothing was posted after the customer lookup.
    expect(fetchMock.mock.calls.slice(1).every(([, init]) => (init?.method ?? "GET") === "GET")).toBe(true);
  });

  it("has no snapshot before a demo journey completed", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(ok({ data: { id: "c-new" } }))
      .mockResolvedValueOnce(ok({ data: [], meta: { next_id: null } }));
    await expect(demoSnapshot("morada-demo-u2")).resolves.toBeNull();
  });

  it("wraps a non-JSON failure into an http code", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: false,
      status: 502,
      statusText: "Bad Gateway",
      json: async () => {
        throw new Error("not json");
      },
    } as unknown as Response);
    await expect(ensureCustomer("x")).rejects.toBeInstanceOf(SaltEdgeError);
    await expect(
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        ko(500, {}),
      ) && ensureCustomer("x").catch((e: SaltEdgeError) => e.code),
    ).resolves.toBe("http_500");
  });
});
