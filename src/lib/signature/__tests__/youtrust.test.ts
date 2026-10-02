import { describe, expect, it } from "vitest";
import { YOUTRUST_BASE, anchorFor, isProviderError, requestStatusOf, signerStatusOf, youtrustClient, type SendRequest } from "@/lib/signature/youtrust";

/**
 * The Youtrust client against a recorded stand-in: the requests it makes,
 * in order and with the fields Youtrust's specification names, the draft it
 * deletes when a step fails, and what each failure becomes.
 */
interface Call {
  method: string;
  url: string;
  headers: Record<string, string>;
  json?: Record<string, unknown>;
  form?: Record<string, string>;
}

type Reply = { status: number; body?: unknown; bytes?: Uint8Array };

function standIn(route: (call: Call, index: number) => Reply | "network") {
  const calls: Call[] = [];
  const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const call: Call = { method: String(init?.method ?? "GET"), url: String(url), headers };
    if (init?.body instanceof FormData) {
      call.form = {};
      for (const [k, v] of init.body.entries()) call.form[k] = typeof v === "string" ? v : `file:${(v as File).name}:${(v as File).size}`;
    } else if (typeof init?.body === "string") call.json = JSON.parse(init.body);
    calls.push(call);
    const reply = route(call, calls.length - 1);
    if (reply === "network") throw new TypeError("fetch failed");
    if (reply.bytes) return new Response(new Blob([new Uint8Array(reply.bytes)]), { status: reply.status, headers: { "Content-Type": "application/pdf" } });
    return new Response(reply.body === undefined ? null : JSON.stringify(reply.body), { status: reply.status, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  return { calls, client: youtrustClient({ apiKey: "sandbox-key", env: "sandbox", fetchImpl }) };
}

const request: SendRequest = {
  name: "Contrat de bail · Maison",
  externalId: "0f0f0f0f-0000-4000-8000-0000000000e1",
  fileName: "Contrat de bail · Maison.pdf",
  pdf: Buffer.from("%PDF-1.7 test"),
  expiresOn: "2026-11-01",
  signers: [
    { firstName: "Anna", lastName: "Weber", email: "anna@example.lu", phone: "+352621123456", locale: "fr", level: "advanced_electronic_signature", authMode: "otp_sms" },
    { firstName: "Alex", lastName: "Test", email: "alex@example.lu", phone: null, locale: "fr", level: "electronic_signature", authMode: "otp_email" },
  ],
};

describe("the Youtrust client", () => {
  it("creates the request, uploads the contract with its anchors, adds the signers in order, then activates", async () => {
    const { calls, client } = standIn((call) => {
      if (call.url.endsWith("/signature_requests") && call.method === "POST") return { status: 201, body: { id: "req-1", status: "draft" } };
      if (call.url.endsWith("/documents")) return { status: 201, body: { id: "doc-1", total_anchors: 2 } };
      if (call.url.endsWith("/signers")) return { status: 201, body: { id: `sig-${calls.filter((c) => c.url.endsWith("/signers")).length}` } };
      if (call.url.endsWith("/activate")) return { status: 201, body: { status: "ongoing" } };
      return { status: 500 };
    });
    expect(await client.send(request)).toEqual({ requestId: "req-1", signerIds: ["sig-1", "sig-2"] });
    expect(calls.map((c) => `${c.method} ${c.url.replace(YOUTRUST_BASE.sandbox, "")}`)).toEqual([
      "POST /signature_requests",
      "POST /signature_requests/req-1/documents",
      "POST /signature_requests/req-1/signers",
      "POST /signature_requests/req-1/signers",
      "POST /signature_requests/req-1/activate",
    ]);
    expect(calls.every((c) => c.headers.Authorization === "Bearer sandbox-key")).toBe(true);
    expect(calls[0].json).toEqual({
      name: "Contrat de bail · Maison",
      delivery_mode: "email",
      ordered_signers: true,
      timezone: "Europe/Luxembourg",
      expiration_date: "2026-11-01",
      external_id: request.externalId,
      reminder_settings: { interval_in_days: 2, max_occurrences: 3 },
    });
    expect(calls[1].form).toMatchObject({ nature: "signable_document", parse_anchors: "true" });
    expect(calls[1].form?.file).toMatch(/^file:Contrat de bail · Maison\.pdf:\d+$/);
    expect(calls[2].json).toEqual({
      info: { first_name: "Anna", last_name: "Weber", email: "anna@example.lu", locale: "fr", phone_number: "+352621123456" },
      signature_level: "advanced_electronic_signature",
      signature_authentication_mode: "otp_sms",
    });
    // No mobile, no phone number sent at all.
    expect(calls[3].json).toEqual({ info: { first_name: "Alex", last_name: "Test", email: "alex@example.lu", locale: "fr" }, signature_level: "electronic_signature", signature_authentication_mode: "otp_email" });
  });

  it("sends no code mode at the qualified level", async () => {
    const { calls, client } = standIn((call) => {
      if (call.url.endsWith("/signature_requests")) return { status: 201, body: { id: "req-q" } };
      if (call.url.endsWith("/documents")) return { status: 201, body: { id: "d", total_anchors: 1 } };
      if (call.url.endsWith("/signers")) return { status: 201, body: { id: "s" } };
      return { status: 201, body: {} };
    });
    await client.send({ ...request, signers: [{ ...request.signers[0], level: "qualified_electronic_signature", authMode: "no_otp" }] });
    expect(calls[2].json?.signature_authentication_mode).toBeNull();
  });

  it("deletes the draft it created when a later step is refused, and says why", async () => {
    const { calls, client } = standIn((call) => {
      if (call.method === "DELETE") return { status: 204 };
      if (call.url.endsWith("/signature_requests")) return { status: 201, body: { id: "req-2" } };
      if (call.url.endsWith("/documents")) return { status: 201, body: { id: "d", total_anchors: 2 } };
      if (call.url.endsWith("/signers")) return { status: 400, body: { detail: "phone_number: invalid" } };
      return { status: 201, body: {} };
    });
    expect(await client.send(request)).toEqual({ error: "invalid", status: 400, detail: "phone_number: invalid" });
    expect(calls.at(-1)).toMatchObject({ method: "DELETE", url: `${YOUTRUST_BASE.sandbox}/signature_requests/req-2` });
  });

  it("refuses to send a contract in which the anchors were not found", async () => {
    const { calls, client } = standIn((call) => {
      if (call.method === "DELETE") return { status: 204 };
      if (call.url.endsWith("/signature_requests")) return { status: 201, body: { id: "req-3" } };
      if (call.url.endsWith("/documents")) return { status: 201, body: { id: "d", total_anchors: 1 } };
      return { status: 201, body: { id: "x" } };
    });
    expect(await client.send(request)).toEqual({ error: "invalid", detail: "anchors" });
    expect(calls.some((c) => c.url.endsWith("/signers"))).toBe(false);
    expect(calls.at(-1)?.method).toBe("DELETE");
  });

  it("names every failure, a lost network included, and never throws", async () => {
    for (const [status, error] of [
      [401, "unauthorized"],
      [403, "forbidden"],
      [404, "not_found"],
      [422, "invalid"],
      [429, "rate_limited"],
      [503, "unavailable"],
    ] as const) {
      const { client } = standIn(() => ({ status, body: { title: "x" } }));
      const r = await client.read("req");
      expect(isProviderError(r) && r.error).toBe(error);
    }
    const { client } = standIn(() => "network");
    expect(await client.read("req")).toEqual({ error: "unavailable" });
  });

  it("reads a request back in this application's words, and downloads the signed contract and the merged audit trail", async () => {
    const { calls, client } = standIn((call) => {
      if (call.url.endsWith("/signers/s-1")) return { status: 200, body: { id: "s-1", signed_at: "2026-10-02T09:15:00+02:00" } };
      if (call.url.includes("/documents/download")) return { status: 200, bytes: new Uint8Array([37, 80, 68, 70]) };
      if (call.url.includes("/audit_trails/download")) return { status: 200, bytes: new Uint8Array([37, 80, 68, 70, 1]) };
      return { status: 200, body: { status: "done", completed_at: "2026-10-02T09:20:00+02:00", signers: [{ id: "s-1", status: "signed" }, { id: "s-2", status: "consent_given" }] } };
    });
    expect(await client.read("req-9")).toEqual({ status: "done", completedAt: "2026-10-02T09:20:00+02:00", signers: [{ id: "s-1", status: "signed" }, { id: "s-2", status: "notified" }] });
    expect(await client.signedAt("req-9", "s-1")).toBe("2026-10-02T09:15:00+02:00");
    expect((await client.signedDocument("req-9")) as Buffer).toEqual(Buffer.from([37, 80, 68, 70]));
    expect(((await client.auditTrails("req-9")) as Buffer).length).toBe(5);
    expect(calls.map((c) => c.url.replace(YOUTRUST_BASE.sandbox, ""))).toEqual([
      "/signature_requests/req-9",
      "/signature_requests/req-9/signers/s-1",
      "/signature_requests/req-9/documents/download?version=completed&archive=false",
      "/signature_requests/req-9/audit_trails/download?merge=true",
    ]);
  });

  it("maps Youtrust's states, and places each signer's field with an anchor at the expected ratio", () => {
    expect(["draft", "ongoing", "approval", "paused", "done", "declined", "rejected", "expired", "canceled", "deleted"].map(requestStatusOf)).toEqual([
      "draft", "ongoing", "ongoing", "ongoing", "done", "declined", "declined", "expired", "canceled", "canceled",
    ]);
    expect(["initiated", "notified", "verified", "processing", "consent_given", "signed", "declined", "aborted", "error"].map(signerStatusOf)).toEqual([
      "pending", "notified", "notified", "notified", "notified", "signed", "declined", "error", "error",
    ]);
    expect(anchorFor(1)).toBe("{{s1|signature|138|60}}");
    expect(anchorFor(3)).toBe("{{s3|signature|138|60}}");
  });
});
