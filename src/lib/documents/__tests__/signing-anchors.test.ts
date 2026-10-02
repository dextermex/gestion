import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { composeDocument } from "@/lib/documents/compose";
import type { ComposeInput, ContractParty, DocumentModel } from "@/lib/documents/model";
import { previewInput } from "@/lib/documents/preview";
import { renderPdf } from "@/lib/documents/render";
import { renderLabels } from "@/lib/documents/generate";
import { anchorFor } from "@/lib/signature/youtrust";

/**
 * A contract produced to be signed electronically carries one anchor per
 * signer, the tenants as named and then the lessor, each drawn as one run of
 * text a provider's parser can read whole; a contract produced for paper
 * carries none, and the template's labels are the same in both.
 */

/** The text of every text object (BT ... ET) of a PDF's content streams, glyph runs joined. */
function textObjects(pdf: Buffer): string[] {
  const raw = pdf.toString("latin1");
  const out: string[] = [];
  let i = 0;
  while ((i = raw.indexOf("stream", i)) >= 0) {
    const start = raw.indexOf("\n", i) + 1;
    const end = raw.indexOf("endstream", start);
    let content = "";
    try {
      content = inflateSync(pdf.subarray(start, end)).toString("latin1");
    } catch {
      content = "";
    }
    for (const block of content.split("BT").slice(1)) {
      const body = block.split("ET")[0];
      const hex = [...body.matchAll(/<([0-9a-fA-F]+)>/g)].map((m) => m[1]).join("");
      if (hex) out.push(Buffer.from(hex, "hex").toString("latin1"));
    }
    i = end + 9;
  }
  return out;
}

/** A tenant who is a person, as the contract names them. */
const person = (name: string, civility: "m" | "f"): ContractParty => ({
  kind: "natural",
  civility,
  name,
  birthDate: "1990-01-01",
  birthPlace: "Luxembourg",
  nationality: "luxembourgeoise",
  address: { line: "1, rue de l'Exemple", locality: "L-1000 Luxembourg", country: "LU" },
});

const contract = (tenants: Array<[string, "m" | "f"]>, signing: boolean): DocumentModel => {
  const base = previewInput("lease_contract", "fr") as ComposeInput<"lease_contract">;
  const anchors = Array.from({ length: tenants.length + 1 }, (_, i) => anchorFor(i + 1));
  const data = { ...base.data, contract: { ...base.data.contract!, tenants: tenants.map(([name, civility]) => person(name, civility)) } };
  return composeDocument({ ...base, tenants: tenants.map(([name]) => name), data, ...(signing ? { signing: { anchors } } : {}) }) as DocumentModel;
};

describe("a contract produced to be signed electronically", () => {
  it("gives each tenant a line with their anchor, in the order named, and the lessor the last one", () => {
    const model = contract([["Anna Weber", "f"], ["Ben Muller", "m"]], true);
    expect(model.signature?.anchors).toEqual({
      first: "{{s3|signature|138|60}}",
      second: [
        { name: "Madame Anna Weber", anchor: "{{s1|signature|138|60}}" },
        { name: "Monsieur Ben Muller", anchor: "{{s2|signature|138|60}}" },
      ],
    });
    const paper = contract([["Anna Weber", "f"], ["Ben Muller", "m"]], false);
    expect(paper.signature?.anchors).toBeUndefined();
    // The template's own labels, unchanged.
    expect(model.signature?.label).toBe(paper.signature?.label);
    expect(model.signature?.second?.label).toBe(paper.signature?.second?.label);
  });

  it("ignores anchors that do not match the signers", () => {
    const base = previewInput("lease_contract", "fr") as Parameters<typeof composeDocument>[0];
    const model = composeDocument({ ...base, tenants: ["Anna Weber"], signing: { anchors: [anchorFor(1)] } }) as DocumentModel;
    expect(model.signature?.anchors).toBeUndefined();
  });

  it("draws every anchor whole, in one run of text, and none on paper", async () => {
    const signed = textObjects(await renderPdf(contract([["Anna Weber", "f"], ["Ben Muller", "m"], ["Carla dos Santos", "f"]], true), renderLabels("fr")));
    for (const position of [1, 2, 3, 4]) {
      expect(signed.filter((t) => t.includes(anchorFor(position)))).toHaveLength(1);
    }
    const paper = textObjects(await renderPdf(contract([["Anna Weber", "f"]], false), renderLabels("fr")));
    expect(paper.some((t) => t.includes("{{"))).toBe(false);
    // Every page carries the footer: the template's version and the page count.
    const pages = paper.filter((t) => /^Page \d+\/\d+$/.test(t));
    expect(pages.length).toBeGreaterThan(1);
    expect(pages[0]).toBe(`Page 1/${pages.length}`);
    expect(paper.some((t) => t.includes("lease_contract v2026-10-02.1"))).toBe(true);
  }, 30_000);
});
