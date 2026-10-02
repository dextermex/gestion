import { describe, expect, it } from "vitest";
import { composeDocument, unfilledPlaceholders } from "@/lib/documents/compose";
import { bankName, contactParty, dwellingOf, lessorParty, partyAddress } from "@/lib/documents/contract-parties";
import type { ComposeInput, ContractParty, DocumentModel, ResidentialContractData } from "@/lib/documents/model";
import { previewInput } from "@/lib/documents/preview";
import { frenchCardinal, frenchLongDate, frenchSpacing } from "@/lib/documents/wording/fr-contract";
import { getParamValue } from "@/domain/legal/params";

/**
 * The cases the lessor's template did not write out, each composed from
 * the facts: a company on either side, a neutral civility, several tenants,
 * an open term, a furnished dwelling, a house outside any co-ownership, the
 * other forms of guarantee, a flat charge or none. And the readers that
 * turn the rows into named parties, with what each still lacks.
 */
const person = (name: string, civility: "m" | "f" | "x" = "f"): ContractParty => ({
  kind: "natural",
  civility,
  name,
  birthDate: "1988-02-01",
  birthPlace: "Ettelbruck",
  nationality: "luxembourgeoise",
  address: { line: "3, rue des Prés", locality: "L-9010 Ettelbruck", country: "LU" },
});
const company = (name: string, legalForm = "sarl"): ContractParty => ({
  kind: "legal",
  name,
  legalForm,
  seat: { line: "5, avenue Monterey", locality: "L-2163 Luxembourg", country: "LU" },
  rcsNumber: "B987654",
  representative: "Paul Schmit",
  representativeRole: "gérant",
});

function compose(change: { data?: Partial<ComposeInput<"lease_contract">["data"]>; contract?: Partial<ResidentialContractData>; signing?: boolean } = {}): DocumentModel {
  const base = previewInput("lease_contract", "fr") as ComposeInput<"lease_contract">;
  const contract = { ...base.data.contract!, ...change.contract };
  const data = { ...base.data, ...change.data, contract };
  const anchors = change.signing ? Array.from({ length: contract.tenants.length + 1 }, (_, i) => `{{s${i + 1}|signature|138|60}}`) : undefined;
  const model = composeDocument({ ...base, data, ...(anchors ? { signing: { anchors } } : {}) }) as DocumentModel;
  expect(unfilledPlaceholders(model)).toEqual([]);
  // The bound spaces of French typography read as spaces here: the words are what is compared.
  const plain = (t: string) => t.replace(/\u00a0/g, " ");
  return {
    ...model,
    sections: model.sections.map((s) => ({ ...s, heading: s.heading && plain(s.heading), lead: s.lead && plain(s.lead), paragraphs: s.paragraphs?.map(plain), items: s.items?.map(plain) })),
    closing: model.closing?.map(plain),
  };
}
const text = (m: DocumentModel) => m.sections.flatMap((s) => [s.heading ?? "", s.lead ?? "", ...(s.paragraphs ?? []), ...(s.items ?? [])]).concat(m.closing ?? []).join("\n");
const article = (m: DocumentModel, n: number) => m.sections.find((s) => s.heading?.startsWith(`${n}. `))!;

describe("the parties", () => {
  it("names a company lessor and a company tenant by name, form, seat, register number and who signs", () => {
    const m = compose({ contract: { lessor: company("Immo Nord s.à r.l."), tenants: [company("Acme Luxembourg S.A.", "sa")] } });
    const parties = text(m);
    expect(parties).toContain(
      "Immo Nord s.à r.l., société à responsabilité limitée, établie et ayant son siège social à L-2163 Luxembourg, 5, avenue Monterey, immatriculée au Registre de commerce et des sociétés de Luxembourg sous le numéro B987654, représentée par Paul Schmit, agissant en qualité de gérant.",
    );
    expect(parties).toContain("Acme Luxembourg S.A., société anonyme, établie et ayant son siège social à");
    expect(m.signature?.name).toBe("Immo Nord s.à r.l., représentée par Paul Schmit");
    expect(m.signature?.second?.names).toEqual(["Acme Luxembourg S.A., représentée par Paul Schmit"]);
    // A company does not live in the dwelling: the person it houses does, and declares the arrival.
    expect(article(m, 2).paragraphs?.[0]).toContain("de la personne physique que le Locataire y loge");
    expect(article(m, 2).paragraphs?.[2]).toMatch(/^Le Locataire veille à ce que l'occupant déclare son arrivée/);
  });

  it("leaves the legal form out when it is none of the listed ones", () => {
    const m = compose({ contract: { lessor: company("Fonds Immobilier", "other") } });
    expect(text(m)).toContain("Fonds Immobilier, établie et ayant son siège social à L-2163 Luxembourg");
  });

  it("names a person with the template's civility or with none, and gives each of several tenants a line", () => {
    const m = compose({ contract: { lessor: person("Claude Hoffmann", "x"), tenants: [person("Anna Weber", "f"), person("Luc Weber", "m")] } });
    const parties = text(m);
    expect(parties).toContain("Claude Hoffmann, né(e) le 1er février 1988 à Ettelbruck, de nationalité luxembourgeoise, demeurant 3, rue des Prés, L-9010 Ettelbruck.");
    expect(parties).toContain("Madame Anna Weber, née le 1er février 1988 à Ettelbruck, de nationalité luxembourgeoise, demeurant actuellement 3, rue des Prés, L-9010 Ettelbruck.");
    expect(parties).toContain("Monsieur Luc Weber, né le 1er février 1988");
    // Two people sign as tenants: one line each, the destination stays the template's.
    expect(m.signature?.second?.names).toEqual(["Madame Anna Weber", "Monsieur Luc Weber"]);
    expect(article(m, 2).paragraphs?.[0]).toBe("Le Logement est destiné exclusivement à l'habitation du Locataire et des membres de son ménage, à titre de résidence principale.");
  });

  it("writes an address abroad with its country", () => {
    const abroad = { ...person("Sophie Lambert"), address: { line: "14, rue Haute", locality: "6700 Arlon", country: "BE" } } as ContractParty;
    expect(text(compose({ contract: { tenants: [abroad] } }))).toContain("demeurant actuellement 14, rue Haute, 6700 Arlon, Belgique.");
  });
});

describe("the dwelling and the terms", () => {
  it("lets an open term, without the fixed-term restriction on the tenant's notice", () => {
    const m = compose({ data: { endDate: null } });
    expect(article(m, 3).paragraphs?.[0]).toBe("Le présent bail est conclu pour une durée indéterminée prenant effet le 1er octobre 2026.");
    expect(text(m)).not.toContain("Pendant la durée déterminée initiale");
  });

  it("lets a furnished dwelling with its supplement and inventory, and a house outside any co-ownership", () => {
    const m = compose({ data: { furnished: true, furnitureSupplementCents: 12000 }, contract: { dwelling: "house", copropriete: false } });
    const all = text(m);
    expect(article(m, 1).paragraphs?.[0]).toMatch(/^Le Bailleur donne en location au Locataire, qui accepte, une maison située /);
    expect(all).toContain("Le Logement est loué meublé ; l'inventaire du mobilier, signé par les Parties, est annexé au présent contrat.");
    expect(article(m, 5).paragraphs?.[1]).toMatch(/^Le supplément de loyer pour le mobilier est fixé à 120,00\s€ par mois\.$/);
    expect(article(m, 14).items).toContain("l'inventaire du mobilier ;");
    expect(all).not.toContain("soumis au statut de la copropriété");
    expect(article(m, 10).items).toContain("remettre au Locataire une copie du certificat de performance énergétique en cours de validité ;");
    expect(article(m, 14).items?.some((i) => i.startsWith("les extraits du règlement de copropriété"))).toBe(false);
  });

  it("describes the lot from its facts when the lease does not describe the rooms", () => {
    expect(article(compose(), 1).paragraphs?.[2]).toBe("Le Logement comprend les pièces et parties d'immeuble suivantes : Appartement Exemple, étage 2, 72 m², 3 pièces, 2 chambres.");
    expect(article(compose({ contract: { premises: "un séjour, une cuisine équipée, deux chambres, une salle de bains et une cave n° 4" } }), 1).paragraphs?.[2]).toBe(
      "Le Logement comprend les pièces et parties d'immeuble suivantes : un séjour, une cuisine équipée, deux chambres, une salle de bains et une cave n° 4.",
    );
  });

  it("takes the rent on the day the lease says, and charges as advances, a flat sum or none", () => {
    expect(article(compose({ data: { paymentDay: 5 } }), 5).paragraphs?.[1]).toContain("au plus tard le 5 de chaque mois");
    const flat = compose({ data: { chargesRegime: "forfait" } });
    expect(article(flat, 6).paragraphs?.[0]).toMatch(/^Le Locataire verse en sus du loyer, aux mêmes échéances, un forfait mensuel de charges de 150,00\s€\.$/);
    expect(text(flat)).not.toContain("décompte détaillé des charges");
    expect(article(compose({ data: { chargesCents: 0 } }), 6).paragraphs?.[0]).toBe("Aucun acompte sur charges n'est perçu en sus du loyer.");
  });

  it("names the guarantee in the form agreed, and says so when there is none", () => {
    expect(article(compose({ data: { depositForm: "cash" } }), 7).paragraphs?.[0]).toContain("sous la forme suivante : dépôt d'une somme d'argent sur un compte bancaire bloqué ouvert au nom du Locataire.");
    expect(article(compose({ data: { depositForm: "third_party_caution" } }), 7).paragraphs?.[0]).toContain("cautionnement solidaire d'un tiers");
    expect(article(compose({ data: { depositCents: 0, depositMonths: 0 } }), 7).paragraphs).toEqual(["Aucune garantie locative n'est exigée du Locataire."]);
  });

  it("prints every statutory figure from the registry, in words where the template spells it", () => {
    const on = "2026-09-26";
    const all = text(compose());
    expect(all).toContain(`préavis de ${frenchCardinal(getParamValue("residential.notice_tenant_months", on))} (${getParamValue("residential.notice_tenant_months", on)}) mois`);
    expect(all).toContain(`le délai de résiliation est de ${frenchCardinal(getParamValue("residential.notice_landlord_personal_need_months", on))} mois`);
    expect(all).toContain(`dépassant ${getParamValue("residential.rent_ceiling_pct_of_capital", on)} % du capital investi`);
    expect(all).toContain(`n'excède pas ${frenchCardinal(getParamValue("residential.deposit_max_months", on))} mois de loyer`);
    expect(all).toContain(`égale à ${getParamValue("residential.deposit_penalty_pct_of_monthly_rent_per_month", on)} % du loyer mensuel`);
    expect(all).toContain(`dans les ${frenchCardinal(getParamValue("compliance.commune_arrival_declaration_days", on))} jours de son emménagement`);
  });

  it("drops the handwritten mention from a contract signed electronically", () => {
    const signed = compose({ signing: true });
    expect(signed.closing).toEqual(["Fait à Luxembourg, le 26 septembre 2026, en autant d'exemplaires originaux que de Parties."]);
    expect(compose().closing).toContain("Signatures précédées de la mention manuscrite « Lu et approuvé ».");
  });
});

describe("the parties read from the rows", () => {
  it("lists what a lessor still lacks, as a person or as a company, and asks first which one it is", () => {
    const base = { legal_name: "Nora Kremer", address_street: "Rue de Bonnevoie", address_number: "24", postal_code: "1260", city: "Luxembourg", country: "LU" };
    expect(lessorParty({ ...base, lessor_kind: "" }).missing).toEqual(["kind"]);
    expect(lessorParty({ lessor_kind: "" }).missing).toEqual(["kind", "name", "address"]);
    expect(lessorParty({ ...base, lessor_kind: "natural", lessor_civility: "f" }).missing).toEqual(["birth_date", "birth_place", "nationality"]);
    expect(lessorParty({ ...base, lessor_kind: "legal", lessor_legal_form: "llc" }).missing).toEqual(["legal_form", "rcs_number", "representative", "representative_role"]);
    const done = lessorParty({ ...base, lessor_kind: "natural", lessor_civility: "f", lessor_birth_date: "1975-04-12", lessor_birth_place: "Esch-sur-Alzette", lessor_nationality: "luxembourgeoise" });
    expect(done).toEqual({
      missing: [],
      party: { kind: "natural", civility: "f", name: "Nora Kremer", birthDate: "1975-04-12", birthPlace: "Esch-sur-Alzette", nationality: "luxembourgeoise", address: { line: "24, Rue de Bonnevoie", locality: "L-1260 Luxembourg", country: "LU" } },
    });
  });

  it("lists what a tenant still lacks, as a person or as a company", () => {
    expect(contactParty({ kind: "natural", first_name: "Anna", last_name: "Weber" }).missing).toEqual(["civility", "birth_date", "birth_place", "nationality", "address"]);
    expect(contactParty({ kind: "legal", legal_name: "Acme S.A.", legal_form: "sa", address: { street: "Avenue Monterey", postal_code: "2163", city: "Luxembourg" } }).missing).toEqual(["rcs_number", "representative", "representative_role"]);
    expect(contactParty({ kind: "natural", civility: "m", first_name: "Marc", last_name: "Weber", birth_date: "1980-01-02T00:00:00", birth_place: "Luxembourg", nationality: "française", address: { street: "Rue Haute", number: "14", postal_code: "6700", city: "Arlon", country: "BE" } })).toEqual({
      missing: [],
      party: { kind: "natural", civility: "m", name: "Marc Weber", birthDate: "1980-01-02", birthPlace: "Luxembourg", nationality: "française", address: { line: "14, Rue Haute", locality: "6700 Arlon", country: "BE" } },
    });
  });

  it("writes addresses, banks and dwellings the way the contract prints them", () => {
    expect(partyAddress({ street: "Rue de la Gare", number: "12", postalCode: "L-8001", city: "Strassen" })).toEqual({ line: "12, Rue de la Gare", locality: "L-8001 Strassen", country: "LU" });
    expect(bankName("BCEELULLXXX")).toBe("Banque et Caisse d'Épargne de l'État, Luxembourg");
    expect(bankName("REVOLT21")).toBe("REVOLT21");
    expect(dwellingOf("apartment_building")).toBe("apartment");
    expect(dwellingOf("house")).toBe("house");
    expect(dwellingOf("office")).toBe("other");
  });

  it("spells numbers and dates as a French contract does", () => {
    expect([0, 1, 3, 8, 16, 17, 21, 24, 70, 71, 77, 80, 81, 91, 99].map(frenchCardinal)).toEqual([
      "zéro", "un", "trois", "huit", "seize", "dix-sept", "vingt et un", "vingt-quatre", "soixante-dix", "soixante et onze", "soixante-dix-sept", "quatre-vingts", "quatre-vingt-un", "quatre-vingt-onze", "quatre-vingt-dix-neuf",
    ]);
    expect(frenchLongDate("2026-10-01")).toBe("1er octobre 2026");
    expect(frenchSpacing("IBAN : LU28 – Banque : BCEE ; « le Bailleur » à 5 %")).toBe("IBAN\u00a0: LU28 – Banque\u00a0: BCEE\u00a0; «\u00a0le Bailleur\u00a0» à 5\u00a0%");
    expect(frenchLongDate("1985-03-15")).toBe("15 mars 1985");
  });
});
