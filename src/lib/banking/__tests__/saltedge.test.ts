import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  SaltEdgeError,
  createConnectSession,
  ensureCustomer,
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

  it("creates a customer and returns its id", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(ok({ data: { id: "cust-1" } }));
    await expect(ensureCustomer("morada-u1")).resolves.toBe("cust-1");
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("https://www.saltedge.com/api/v5/customers");
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
        ok({ data: [{ id: "cust-9", identifier: "morada-u1" }], meta: { next_id: null } }),
      );
    await expect(ensureCustomer("morada-u1")).resolves.toBe("cust-9");
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
      createConnectSession("cust-1", "https://app.morada.lu/app/banque?connexion=retour", "fr"),
    ).resolves.toBe("https://connect.example/x");
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body.data.customer_id).toBe("cust-1");
    expect(body.data.consent.scopes).toEqual(["account_details", "transactions_details"]);
    expect(body.data.attempt.return_to).toBe("https://app.morada.lu/app/banque?connexion=retour");
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
