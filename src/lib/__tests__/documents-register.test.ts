import { describe, expect, it } from "vitest";
import { validateRecognition, recognitionPrompt } from "@/lib/documents/recognition";
import { filterDocuments, searchWords, summariseDocuments } from "@/lib/documents/summary";
import { DOCUMENT_GROUPS, groupOf } from "@/lib/gestion/documents-rules";

/**
 * The register's pure parts: what the reader's answer goes through before
 * a screen sees it, what the register says about itself, and how a filter
 * reads over a sample cabinet held whole.
 */

const CANDIDATES = ["p-beaulieu", "p-gare"];

describe("validateRecognition", () => {
  it("keeps a sound answer, bounded", () => {
    const r = validateRecognition(
      {
        klass: "invoice",
        title: "  Facture Krier 2026-0812 · chaudière  ",
        summary: "Entretien annuel de la chaudière de l'Apt 3B.",
        document_date: "2026-08-08",
        amount_cents: 124000,
        parties: ["Krier Chauffage Sàrl", " Cabinet Reuter ", "", "A", "B", "C"],
        reference: "2026-0812",
        related_id: "p-beaulieu",
        confidence: "high",
      },
      CANDIDATES,
    );
    expect(r).toEqual({
      klass: "invoice",
      title: "Facture Krier 2026-0812 · chaudière",
      summary: "Entretien annuel de la chaudière de l'Apt 3B.",
      documentDate: "2026-08-08",
      amountCents: 124000,
      parties: ["Krier Chauffage Sàrl", "Cabinet Reuter", "A", "B"],
      reference: "2026-0812",
      relatedId: "p-beaulieu",
      confidence: "high",
    });
  });

  it("files an unknown class as other, binds no record outside the candidates, drops what is not a day or a sane amount", () => {
    const r = validateRecognition(
      { klass: "poem", title: "x", summary: "", document_date: "2026-02-30", amount_cents: 12.5, parties: "nobody", reference: null, related_id: "p-elsewhere", confidence: "certain" },
      CANDIDATES,
    );
    expect(r?.klass).toBe("other");
    expect(r?.relatedId).toBeNull();
    expect(r?.documentDate).toBeNull();
    expect(r?.amountCents).toBeNull();
    expect(r?.parties).toEqual([]);
    expect(r?.reference).toBeNull();
    expect(r?.confidence).toBe("low");
  });

  it("has nothing to say about a non-answer", () => {
    expect(validateRecognition(null, CANDIDATES)).toBeNull();
    expect(validateRecognition("invoice", CANDIDATES)).toBeNull();
  });

  it("names every class and every candidate in the instruction", () => {
    const prompt = recognitionPrompt("fr", [{ id: "p-beaulieu", label: "Résidence Beaulieu" }]);
    for (const klass of Object.values(DOCUMENT_GROUPS).flat()) expect(prompt).toContain(`- ${klass}:`);
    expect(prompt).toContain("- p-beaulieu: Résidence Beaulieu");
    expect(prompt).toContain("in French");
  });
});

const TODAY = "2026-08-23";
const DOCS = [
  { id: "a", name: "Bail Apt 3B · Muller.pdf", klass: "lease", kind: "lease_contract", sealed: true, retentionUntil: "2036-04-01", createdAt: "2023-03-20", relatedLabel: "Apt 3B" },
  { id: "b", name: "Facture Krier 2026-0812.pdf", klass: "invoice", sealed: false, retentionUntil: "2036-08-08", createdAt: "2026-08-08", relatedLabel: "INT-2026-0141" },
  { id: "c", name: "Dossier candidature T. Schmit.zip", klass: "other", sealed: false, retentionUntil: "2026-10-30", createdAt: "2026-07-30", relatedLabel: "Local RDC Kirchberg" },
  { id: "d", name: "Acte notarié Studio Gare.pdf", klass: "deed", sealed: true, retentionUntil: null, createdAt: "2024-06-01", relatedLabel: "Studio Quartier Gare" },
];

describe("summariseDocuments", () => {
  it("counts what the register holds, by shelf, with the clocks about to run out", () => {
    const s = summariseDocuments(DOCS, TODAY);
    expect(s.total).toBe(4);
    expect(s.sealed).toBe(2);
    expect(s.unfiled).toBe(1);
    expect(s.generated).toBe(1);
    expect(s.purgeDue).toBe(1);
    expect(s.nextPurge).toBe("2026-10-30");
    expect(s.recent).toBe(2);
    expect(s.lastAdded).toBe("2026-08-08");
    expect(s.byGroup).toMatchObject({ tenancy: 1, money: 1, other: 1, title: 1, tax: 0 });
  });

  it("takes the exact count the server gave when the rows are capped", () => {
    expect(summariseDocuments(DOCS, TODAY, 2500).total).toBe(2500);
  });

  it("puts an unknown class with the other pieces", () => {
    expect(groupOf("poem")).toBe("other");
    expect(groupOf("edl")).toBe("tenancy");
  });
});

describe("searchWords and filterDocuments", () => {
  it("keeps words only, bounded, without the characters a filter grammar reads", () => {
    expect(searchWords("  Krier, (2026) 'facture' %x_ ")).toEqual(["Krier", "2026", "facture", "x"]);
    expect(searchWords("a b c d e f g")).toHaveLength(5);
    expect(searchWords(undefined)).toEqual([]);
  });

  it("narrows a register held whole by shelf, by words (accents folded) and by the purge horizon", () => {
    expect(filterDocuments(DOCS, { classes: DOCUMENT_GROUPS.tenancy }, TODAY).map((d) => d.id)).toEqual(["a"]);
    expect(filterDocuments(DOCS, { words: ["notarie", "gare"] }, TODAY).map((d) => d.id)).toEqual(["d"]);
    expect(filterDocuments(DOCS, { words: ["kirchberg"] }, TODAY).map((d) => d.id)).toEqual(["c"]);
    expect(filterDocuments(DOCS, { purgeSoon: true }, TODAY).map((d) => d.id)).toEqual(["c"]);
    expect(filterDocuments(DOCS, {}, TODAY)).toHaveLength(4);
  });
});
