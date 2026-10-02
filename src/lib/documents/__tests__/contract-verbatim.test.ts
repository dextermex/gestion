import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { composeDocument, unfilledPlaceholders } from "@/lib/documents/compose";
import type { ComposeInput, ContractParty, DocumentModel } from "@/lib/documents/model";
import { previewInput } from "@/lib/documents/preview";

/**
 * The residential contract is the lessor's own text. The template the
 * lessor handed over on 2 October 2026 is kept beside this test as it was
 * given; a contract composed for the case that template describes (two
 * persons, an apartment in a co-ownership, unfurnished, a fixed term,
 * monthly advances on charges, a bank guarantee, rent due on the first)
 * must read the same, line by line, every blank filled and nothing else
 * changed. A word moved in the wording fails here before any document
 * carries it.
 */
const TEMPLATE = readFileSync(join(__dirname, "fixtures", "bail-habitation-2026-10-02.txt"), "utf8");

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** A line of the template as a pattern: each blank stands for any filled-in value. */
const pattern = (line: string) => new RegExp(`^${escape(line).replace(/_{3,}/g, ".+?")}$`);

/** The template's lines up to the signature blocks, list markers removed. */
function templateLines(): string[] {
  const lines = TEMPLATE.split("\n").map((l) => l.trim()).filter(Boolean);
  const end = lines.findIndex((l) => l.startsWith("Signatures précédées"));
  return lines.slice(0, end + 1).map((l) => l.replace(/^\* /, ""));
}

/** Every line the composed contract prints, in reading order. */
function composedLines(model: DocumentModel): string[] {
  const out = [model.title.toLocaleUpperCase("fr"), model.subtitle ?? ""];
  for (const s of model.sections) {
    if (s.heading) out.push(s.heading);
    if (s.lead) out.push(s.lead);
    out.push(...(s.paragraphs ?? []), ...(s.items ?? []));
  }
  // French spacing binds some spaces (before ":" or "»"): the words and signs are the template's, only the space is unbreakable.
  return [...out, ...(model.closing ?? [])].filter(Boolean).map((l) => l.replace(/\u00a0/g, " "));
}

const man = (name: string): ContractParty => ({
  kind: "natural",
  civility: "m",
  name,
  birthDate: "1980-06-15",
  birthPlace: "Luxembourg",
  nationality: "luxembourgeoise",
  address: { line: "24, rue de Bonnevoie", locality: "L-1260 Luxembourg", country: "LU" },
});

function composed(change: (input: ComposeInput<"lease_contract">) => void = () => {}): DocumentModel {
  const input = previewInput("lease_contract", "fr") as ComposeInput<"lease_contract">;
  input.watermark = undefined;
  input.data = { ...input.data, contract: { ...input.data.contract!, lessor: man("Jean Dupont"), tenants: [man("Marc Weber")] } };
  change(input);
  return composeDocument(input) as DocumentModel;
}

describe("the residential contract", () => {
  it("reads as the lessor's template, line by line, every blank filled", () => {
    const expected = templateLines();
    const got = composedLines(composed());
    expect(got).toHaveLength(expected.length);
    expected.forEach((line, i) => expect(got[i], `line ${i + 1}: ${line.slice(0, 60)}`).toMatch(pattern(line)));
  });

  it("signs as the template's blocks say, each party under its own name", () => {
    const model = composed();
    expect(model.signature?.label).toBe("Le Bailleur");
    expect(model.signature?.name).toBe("Monsieur Jean Dupont");
    expect(model.signature?.second?.label).toBe("Le Locataire");
    expect(model.signature?.second?.names).toEqual(["Monsieur Marc Weber"]);
    expect(unfilledPlaceholders(model)).toEqual([]);
  });
});
