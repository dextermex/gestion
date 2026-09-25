import { describe, expect, it } from "vitest";
import { fr } from "@/lib/i18n/fr";
import { getParam, type LegalParamKey } from "@/domain/legal/params";
import { composeDocument, unfilledPlaceholders } from "@/lib/documents/compose";
import { epcPayload } from "@/lib/documents/epc";
import { DOCUMENT_KINDS, KIND_CLASS, KIND_SOURCE, isDocumentKind } from "@/lib/documents/kinds";
import { sealManifest } from "@/lib/documents/manifest";
import type { DocumentModel } from "@/lib/documents/model";
import { previewInput } from "@/lib/documents/preview";
import { missingForDocuments, parseSettingsInput, postalAddress, validIban } from "@/lib/documents/settings-rules";
import { availableLanguages, templateFor, templateVersion } from "@/lib/documents/wording";

/**
 * The paper trail before any PDF exists: the kinds and where they file,
 * the payment code a banking app scans, the manifest an inventory is
 * sealed with, the settings a form is read into, and every template
 * composed from its fixture into a model with nothing left unfilled.
 */
describe("document kinds", () => {
  it("names every kind, its source, its register class, and the dictionary labels each", () => {
    for (const kind of DOCUMENT_KINDS) {
      expect(KIND_SOURCE[kind]).toBeTruthy();
      expect(KIND_CLASS[kind]).toBeTruthy();
      expect(fr.documents.kindLabels[kind]).toBeTruthy();
    }
    expect(isDocumentKind("rent_notice")).toBe(true);
    expect(isDocumentKind("invoice")).toBe(false);
  });
});

describe("EPC QR payload", () => {
  it("writes the SCT payload a banking app scans, the creditor reference first", () => {
    const lines = epcPayload({ holderName: "Cabinet Reuter s.à r.l.", iban: "LU28 0019 4006 4475 0000", bic: "BCEELULL", amountCents: 140000, reference: "RF18 5390 0754 7034" }).split("\n");
    expect(lines).toEqual(["BCD", "002", "1", "SCT", "BCEELULL", "Cabinet Reuter s.à r.l.", "LU280019400644750000", "EUR1400.00", "", "RF18539007547034", ""]);
  });
  it("falls back to free text without a reference, never both, and the BIC stays optional", () => {
    const lines = epcPayload({ holderName: "X", iban: "LU280019400644750000", amountCents: 5, text: "Loyer\noctobre" }).split("\n");
    expect(lines[4]).toBe("");
    expect(lines[7]).toBe("EUR0.05");
    expect(lines[9]).toBe("");
    expect(lines[10]).toBe("Loyer octobre");
  });
});

describe("inventory manifest", () => {
  it("hashes the same rows to the same fingerprint whatever their order, and a changed note to another", () => {
    const session = { id: "s1", kind: "entry", completedAt: "2026-09-25", keyHandoverAt: "2026-09-25" };
    const items = [
      { id: "b", room: "Cuisine", category: "paint", condition: "good", notes: "" },
      { id: "a", room: "Séjour", category: "floors", condition: "fair", notes: "rayure  légère" },
    ];
    const photos = [
      { id: "p2", itemId: "a", sha256: "ff", capturedAt: "2026-09-25T10:00:00Z" },
      { id: "p1", itemId: "b", sha256: "aa", capturedAt: "2026-09-25T09:00:00Z" },
    ];
    const one = sealManifest(session, items, photos);
    const two = sealManifest(session, [...items].reverse(), [...photos].reverse());
    expect(one.sha256).toBe(two.sha256);
    expect(one.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(one.manifest.split("\n")[1]).toBe("item a Séjour floors fair rayure légère");
    expect(sealManifest(session, [{ ...items[1], notes: "rayure profonde" }, items[0]], photos).sha256).not.toBe(one.sha256);
  });
});

describe("lessor settings", () => {
  it("checks an IBAN by its ISO 7064 remainder, and lets an empty one through", () => {
    expect(validIban("LU28 0019 4006 4475 0000")).toBe(true);
    expect(validIban("LU280019400644750001")).toBe(false);
    expect(validIban("FR7630006000011234567890189")).toBe(true);
    expect(validIban("")).toBe(true);
    expect(validIban("LU28")).toBe(false);
  });
  it("reads the form once and names the field it refuses", () => {
    const ok = parseSettingsInput({
      legalName: " Cabinet Reuter s.à r.l. ",
      iban: "lu28 0019 4006 4475 0000",
      bic: "bceelull",
      email: "alex@cabinet-reuter.lu",
      documentLang: "fr",
      country: "lu",
      postalCode: "1260",
      city: "Luxembourg",
      addressStreet: "Rue de Bonnevoie",
      addressNumber: "24",
      holderName: "Cabinet Reuter s.à r.l.",
    });
    expect(ok).toMatchObject({ legalName: "Cabinet Reuter s.à r.l.", iban: "LU280019400644750000", bic: "BCEELULL", country: "LU", documentLang: "fr", holderName: "Cabinet Reuter s.à r.l." });
    expect(parseSettingsInput({ legalName: "" })).toEqual({ problem: "legalName" });
    expect(parseSettingsInput({ legalName: "X", iban: "LU00" })).toEqual({ problem: "iban" });
    expect(parseSettingsInput({ legalName: "X", bic: "12" })).toEqual({ problem: "bic" });
    expect(parseSettingsInput({ legalName: "X", email: "not-an-email" })).toEqual({ problem: "email" });
    expect(parseSettingsInput({ legalName: "X", documentLang: "xx" })).toEqual({ problem: "documentLang" });
    expect(parseSettingsInput({ legalName: "X" })).toMatchObject({ country: "LU", documentLang: "fr", iban: "" });
  });
  it("says what a document still lacks, and prints a Luxembourg address once", () => {
    const s = { legalName: "X", addressStreet: "", postalCode: "", city: "", iban: "", holderName: "" };
    expect(missingForDocuments(s, true)).toEqual(["address", "payment"]);
    expect(missingForDocuments({ ...s, legalName: "" }, false)).toEqual(["legalName", "address"]);
    expect(missingForDocuments({ ...s, addressStreet: "Rue", postalCode: "1260", city: "Luxembourg" }, false)).toEqual([]);
    expect(postalAddress({ addressStreet: "Rue de Bonnevoie", addressNumber: "24", postalCode: "1260", city: "Luxembourg", country: "LU" })).toBe("24, Rue de Bonnevoie, L-1260 Luxembourg");
    expect(postalAddress({ addressStreet: "Rue de Bonnevoie", addressNumber: "24", postalCode: "L-1260", city: "Luxembourg", country: "LU" })).toBe("24, Rue de Bonnevoie, L-1260 Luxembourg");
    expect(postalAddress({ addressStreet: "Rue X", addressNumber: "", postalCode: "75001", city: "Paris", country: "FR" })).toBe("Rue X, 75001 Paris");
  });
});

describe("templates and composition", () => {
  it("exists in French only, written explicitly, with a version per kind and notes to validate", () => {
    for (const kind of DOCUMENT_KINDS) {
      expect(availableLanguages(kind)).toEqual(["fr"]);
      expect(templateVersion(kind, "fr")).toMatch(/^\d{4}-\d{2}-\d{2}\.\d+$/);
      expect(templateFor(kind, "fr")!.notes.length).toBeGreaterThan(20);
      expect(templateFor(kind, "en")).toBeNull();
      expect(templateFor(kind, "de")).toBeNull();
      expect(templateFor(kind, "lu")).toBeNull();
    }
  });
  it("composes every kind from its fixture with nothing left unfilled, watermarked as a sample", () => {
    for (const kind of DOCUMENT_KINDS) {
      const model = composeDocument(previewInput(kind, "fr"));
      expect("error" in model, kind).toBe(false);
      const m = model as DocumentModel;
      expect(unfilledPlaceholders(m), kind).toEqual([]);
      expect(m.kind).toBe(kind);
      expect(m.version).toBe(templateVersion(kind, "fr"));
      const templateTitle = templateFor(kind, "fr")!.title;
      if (templateTitle.includes("{")) expect(m.title).not.toMatch(/\{/);
      else expect(m.title).toBe(templateTitle);
      expect(m.watermark).toBe(fr.documents.kindLabels[kind] ? "MODÈLE : VALEURS FICTIVES" : undefined);
      expect(m.sender.name).toBe("Bailleur Exemple");
      expect(m.sections.length).toBeGreaterThan(0);
      // Copy rule: no em dash, no arrow, in anything a template writes.
      expect(JSON.stringify(m)).not.toMatch(/—|→/);
    }
  });
  it("refuses a language without a template rather than translating on the fly", () => {
    expect(composeDocument({ ...previewInput("rent_notice", "fr"), lang: "en" })).toEqual({ error: "no_template" });
  });
  it("prints the legal figures from the registry, as of the document's date, never a number of its own", () => {
    const keys = templateFor("deposit_settlement", "fr")!.legalParams;
    expect(keys.length).toBeGreaterThan(0);
    // With a penalty running, every figure the settlement rests on is printed.
    const fixture = previewInput("deposit_settlement", "fr");
    const text = JSON.stringify(composeDocument({ ...fixture, data: { ...(fixture.data as unknown as Record<string, unknown>), penaltyMonths: 2, penaltyCents: 25000 } } as typeof fixture));
    expect(text).toContain("vérifié");
    for (const key of keys) {
      const p = getParam(key as LegalParamKey, "2026-09-26");
      expect(text, key).toContain(String(p.value));
    }
    const indexation = templateFor("indexation_notice", "fr")!.legalParams;
    expect(indexation.length).toBeGreaterThan(0);
  });
  it("puts the payment instructions and the EPC code on a rent notice, and every allocation on a receipt", () => {
    const notice = composeDocument(previewInput("rent_notice", "fr")) as DocumentModel;
    const qr = notice.sections.find((s) => s.qr)?.qr;
    expect(qr).toBeTruthy();
    expect(qr!.payload.split("\n")).toContain("LU280019400644750000");
    expect(qr!.payload.split("\n")).toContain("RF18539007547034");
    expect(JSON.stringify(notice)).toContain("Bailleur Exemple");
    const receipt = composeDocument(previewInput("rent_receipt", "fr")) as DocumentModel;
    expect(receipt.sections.some((s) => s.qr)).toBe(false);
    expect(receipt.sections[0].paragraphs?.join(" ")).toMatch(/1\.400,00\s€ le 2 sept\. 2026/);
    const notice2 = composeDocument({ ...previewInput("rent_notice", "fr"), data: { ...(previewInput("rent_notice", "fr").data as unknown as Record<string, unknown>), allocatedCents: 40000 } } as ReturnType<typeof previewInput>) as DocumentModel;
    expect(notice2.sections[0].paragraphs?.join(" ")).toMatch(/Déjà reçu : 400,00\s€\. Reste à payer : 1\.000,00\s€\./);
    expect(notice.sections[0].paragraphs?.join(" ")).not.toContain("Déjà reçu");
  });
});
