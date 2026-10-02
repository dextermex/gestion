import { describe, expect, it } from "vitest";
import { ADDON_COST_CENTS, ADDON_PRICE_CENTS, USAGE_KINDS, priceFromCost } from "@/lib/billing/prices";
import { authModeFor, isLive, normalizePhone, orderSigners, progressOf, signerIssues, signerLocale, splitName, usageForSending, type SignerInput } from "@/lib/signature/envelope";
import { parseLevels, signatureProvider } from "@/lib/signature/provider";

const signer = (over: Partial<SignerInput> = {}): SignerInput => ({
  role: "tenant",
  contactId: "c-1",
  firstName: "Marc",
  lastName: "Schmit",
  email: "marc.schmit@example.lu",
  phone: "+352621123456",
  locale: "fr",
  level: "electronic_signature",
  ...over,
});

describe("signature rules", () => {
  it("reads a mobile number in international form, or nothing", () => {
    expect(normalizePhone("+352 621 123 456")).toBe("+352621123456");
    expect(normalizePhone("00352 621-123-456")).toBe("+352621123456");
    expect(normalizePhone("(+33) 6.12.34.56.78")).toBe("+33612345678");
    expect(normalizePhone("621 123 456")).toBeNull();
    expect(normalizePhone("+0 123")).toBeNull();
    expect(normalizePhone("")).toBeNull();
    expect(normalizePhone(null)).toBeNull();
  });

  it("splits a name into given names and a family name that keeps its particles", () => {
    expect(splitName("Jean Muller")).toEqual({ firstName: "Jean", lastName: "Muller" });
    expect(splitName("Marie-Claire de la Fontaine")).toEqual({ firstName: "Marie-Claire", lastName: "de la Fontaine" });
    expect(splitName("Ana Maria dos Santos")).toEqual({ firstName: "Ana Maria", lastName: "dos Santos" });
    expect(splitName("Schmit")).toEqual({ firstName: "", lastName: "Schmit" });
    expect(splitName("  ")).toEqual({ firstName: "", lastName: "" });
  });

  it("signs in the contact's language where the provider has it", () => {
    expect(signerLocale("en")).toBe("en");
    expect(signerLocale("de")).toBe("de");
    expect(signerLocale("lu")).toBe("de");
    expect(signerLocale("pt")).toBe("fr");
    expect(signerLocale(null)).toBe("fr");
  });

  it("asks a code by SMS when a mobile is known, by e-mail otherwise, needs the mobile at the advanced level, and none at the qualified", () => {
    expect(authModeFor("electronic_signature", "+352621123456")).toBe("otp_sms");
    expect(authModeFor("electronic_signature", null)).toBe("otp_email");
    expect(authModeFor("advanced_electronic_signature", "+352621123456")).toBe("otp_sms");
    expect(authModeFor("advanced_electronic_signature", null)).toBeNull();
    expect(authModeFor("qualified_electronic_signature", null)).toBe("no_otp");
    expect(authModeFor("qualified_electronic_signature", "+352621123456")).toBe("no_otp");
  });

  it("names what stops a signer from being sent", () => {
    expect(signerIssues(signer())).toEqual([]);
    expect(signerIssues(signer({ phone: null }))).toEqual([]);
    expect(signerIssues(signer({ firstName: " " }))).toEqual(["name"]);
    expect(signerIssues(signer({ email: "marc@" }))).toEqual(["email"]);
    expect(signerIssues(signer({ phone: "621 12" }))).toEqual(["phone"]);
    expect(signerIssues(signer({ phone: null, level: "advanced_electronic_signature" }))).toEqual(["phone"]);
    expect(signerIssues(signer({ phone: null, level: "qualified_electronic_signature" }))).toEqual([]);
  });

  it("orders the tenants as the contract names them, the lessor last, and refuses a set that differs", () => {
    const a = signer({ contactId: "c-a", firstName: "Anna" });
    const b = signer({ contactId: "c-b", firstName: "Ben" });
    const lessor = signer({ role: "tenant", contactId: "c-x", firstName: "Alex", lastName: "Reuter", phone: null });
    const ordered = orderSigners(["c-b", "c-a"], [a, b], lessor);
    expect(ordered?.map((s) => [s.role, s.contactId, s.firstName])).toEqual([
      ["tenant", "c-b", "Ben"],
      ["tenant", "c-a", "Anna"],
      ["lessor", null, "Alex"],
    ]);
    expect(orderSigners(["c-a", "c-b"], [a], lessor)).toBeNull();
    expect(orderSigners(["c-a"], [a, b], lessor)).toBeNull();
    expect(orderSigners(["c-a", "c-z"], [a, b], lessor)).toBeNull();
    expect(orderSigners([], [], lessor)).toBeNull();
  });

  it("puts one sending on the ledger, then every signer beyond the fourth and every advanced or qualified signature", () => {
    expect(usageForSending([{ level: "electronic_signature" }, { level: "electronic_signature" }])).toEqual([
      { kind: "signature_sending", quantity: 1, unitPriceCents: ADDON_PRICE_CENTS.signature_sending, unitCostCents: ADDON_COST_CENTS.signature_sending },
    ]);
    const six = [
      { level: "advanced_electronic_signature" as const },
      { level: "advanced_electronic_signature" as const },
      { level: "qualified_electronic_signature" as const },
      { level: "electronic_signature" as const },
      { level: "electronic_signature" as const },
      { level: "electronic_signature" as const },
    ];
    expect(usageForSending(six).map((l) => [l.kind, l.quantity])).toEqual([
      ["signature_sending", 1],
      ["signature_extra_signer", 2],
      ["signature_advanced", 2],
      ["signature_qualified", 1],
    ]);
  });

  it("prices every add-on at the provider's cost plus 20 %, rounded up to the next 50 cents", () => {
    expect(priceFromCost(200)).toBe(250);
    expect(priceFromCost(1500)).toBe(1800);
    expect(priceFromCost(125)).toBe(150);
    expect(priceFromCost(0)).toBe(0);
    for (const k of USAGE_KINDS) {
      expect(ADDON_PRICE_CENTS[k]).toBeGreaterThanOrEqual(ADDON_COST_CENTS[k]);
      expect(ADDON_PRICE_CENTS[k] % 50).toBe(0);
    }
  });

  it("counts a sending live until it is done, refused, expired, cancelled or failed", () => {
    expect(isLive("draft")).toBe(true);
    expect(isLive("ongoing")).toBe(true);
    for (const s of ["done", "declined", "expired", "canceled", "failed"] as const) expect(isLive(s)).toBe(false);
    expect(progressOf([{ status: "signed" }, { status: "notified" }, { status: "pending" }])).toEqual({ signed: 1, total: 3 });
  });
});

describe("the provider seam", () => {
  it("is connected by the Youtrust key, in its sandbox unless told otherwise, at the simple level by default", () => {
    expect(signatureProvider({})).toEqual({ configured: false, provider: null, env: "sandbox", levels: ["electronic_signature"] });
    expect(signatureProvider({ YOUSIGN_API_KEY: "k" })).toEqual({ configured: true, provider: "yousign", env: "sandbox", levels: ["electronic_signature"] });
    expect(signatureProvider({ YOUSIGN_API_KEY: "k", YOUSIGN_ENV: "production" }).env).toBe("production");
    expect(signatureProvider({ YOUSIGN_API_KEY: " " }).configured).toBe(false);
  });

  it("reads the levels the account carries, in eIDAS order, ignoring anything else", () => {
    expect(parseLevels("qualified_electronic_signature, advanced_electronic_signature, bogus")).toEqual([
      "electronic_signature",
      "advanced_electronic_signature",
      "qualified_electronic_signature",
    ]);
    expect(parseLevels(undefined)).toEqual(["electronic_signature"]);
  });
});
