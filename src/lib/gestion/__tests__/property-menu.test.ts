import { describe, expect, it } from "vitest";
import * as frData from "@/lib/demo/data";
import * as luData from "@/lib/demo/data-lu";
import type { DemoData } from "@/lib/demo";
import type { DemoProperty } from "@/lib/demo/data";
import { addressParts, formatAddress } from "@/lib/gestion/address";
import { initialValues, topicBody, type EditTopic, type MenuGroup } from "@/lib/gestion/editors";
import { buildPortfolio } from "@/lib/gestion/portfolio";
import { propertyMenu } from "@/lib/gestion/property-menu";
import { fr } from "@/lib/i18n/fr";

/**
 * "Modifier" opens every editor on what is stored, and a save writes only
 * what the person changed. The address is the case that went wrong: it used
 * to be taken apart from its printed line, which put the house number in
 * "Rue" and wrote it back.
 */

const demo = frData as unknown as DemoData;

/** The sample cabinet with one property's stored fields replaced. */
function withProperty(id: string, patch: Partial<DemoProperty>): DemoData {
  return { ...demo, PROPERTIES: demo.PROPERTIES.map((p) => (p.id === id ? { ...p, ...patch } : p)) };
}

function menuOf(data: DemoData, propertyId: string): MenuGroup[] {
  const card = buildPortfolio(data).find((c) => c.property.id === propertyId)!;
  return propertyMenu(card, data, fr, "fr").groups;
}

function topicOf(groups: MenuGroup[], id: string): EditTopic {
  for (const group of groups) {
    for (const entry of group.entries) if (entry.id === id && "topic" in entry) return entry.topic;
  }
  throw new Error(`no editor ${id}`);
}

const opened = (topic: EditTopic) => initialValues(topic);

describe("the address editor of a property", () => {
  const stored = (number: string, street: string) => ({
    addressParts: { street, number, postalCode: "L-1611", city: "Luxembourg", country: "LU" },
    address: formatAddress({ street, number, postal_code: "L-1611", city: "Luxembourg" }),
  });

  it("opens on the stored street and number of an address that has a number", () => {
    const info = opened(topicOf(menuOf(withProperty("p-bertrange", stored("12", "rue de la Gare")), "p-bertrange"), "info"));
    expect(info.street).toBe("rue de la Gare");
    expect(info.number).toBe("12");
    expect(info.postal).toBe("L-1611");
    expect(info.city).toBe("Luxembourg");
    expect(info.country).toBe("LU");
  });

  it("opens on an empty number when the address has none", () => {
    const info = opened(topicOf(menuOf(withProperty("p-bertrange", stored("", "Am Duerf")), "p-bertrange"), "info"));
    expect(info.street).toBe("Am Duerf");
    expect(info.number).toBe("");
  });

  it("keeps a number with a letter, and a street that starts with a figure", () => {
    const lettered = opened(topicOf(menuOf(withProperty("p-bertrange", stored("12A", "rue de la Gare")), "p-bertrange"), "info"));
    expect(lettered.number).toBe("12A");
    expect(lettered.street).toBe("rue de la Gare");
    const figure = opened(topicOf(menuOf(withProperty("p-bertrange", stored("3", "10 Septembre")), "p-bertrange"), "info"));
    expect(figure.number).toBe("3");
    expect(figure.street).toBe("10 Septembre");
  });

  it("opens on the stored country", () => {
    const patch = { ...stored("8", "rue des Champs") };
    patch.addressParts.country = "BE";
    expect(opened(topicOf(menuOf(withProperty("p-bertrange", patch), "p-bertrange"), "info")).country).toBe("BE");
  });

  it("saves a new name without sending the address", () => {
    const topic = topicOf(menuOf(withProperty("p-bertrange", stored("12A", "rue de la Gare")), "p-bertrange"), "info");
    expect(topicBody(topic, { ...opened(topic), name: "Maison des Champs" })).toEqual({ name: "Maison des Champs" });
  });

  it("sends the address whole, the other parts as stored, when one part changes", () => {
    const topic = topicOf(menuOf(withProperty("p-bertrange", stored("12A", "rue de la Gare")), "p-bertrange"), "info");
    expect(topicBody(topic, { ...opened(topic), postal: "L-1612" })).toEqual({
      street: "rue de la Gare",
      number: "12A",
      postal: "L-1612",
      city: "Luxembourg",
      country: "LU",
    });
  });

  it("has nothing to save when nothing changed", () => {
    const topic = topicOf(menuOf(demo, "p-bertrange"), "info");
    expect(topicBody(topic, opened(topic))).toBeNull();
    expect(topicBody(topic, { ...opened(topic), name: ` ${opened(topic).name} ` })).toBeNull();
  });
});

describe("the stored parts of an address", () => {
  it("are read as they are, never from the printed line", () => {
    expect(addressParts({ street: "rue de la Gare", number: "12", postal_code: "L-1611", city: "Luxembourg", country: "LU" })).toEqual({
      street: "rue de la Gare",
      number: "12",
      postalCode: "L-1611",
      city: "Luxembourg",
      country: "LU",
    });
    expect(addressParts({ street: "Am Duerf", city: "Schengen" })).toEqual({ street: "Am Duerf", number: "", postalCode: "", city: "Schengen", country: "LU" });
    expect(addressParts({ street: "rue de la Gare", number: "12A", city: "Luxembourg", country: "BE" }).number).toBe("12A");
    expect(addressParts(null)).toEqual({ street: "", number: "", postalCode: "", city: "", country: "LU" });
  });

  it("print as the address line of both sample cabinets", () => {
    for (const data of [frData, luData]) {
      for (const p of data.PROPERTIES) {
        const a = p.addressParts;
        expect(formatAddress({ street: a.street, number: a.number, postal_code: a.postalCode, city: a.city })).toBe(p.address);
      }
    }
  });
});

describe("the other editors behind Modifier", () => {
  it("opens the cadastral reference on its three stored parts and leaves it alone when another field is saved", () => {
    const data = withProperty("p-bertrange", { cadastralParts: { commune: "Bertrange", section: "B", number: "214/889" } });
    const topic = topicOf(menuOf(data, "p-bertrange"), "technical");
    const values = opened(topic);
    expect(values.cadastralCommune).toBe("Bertrange");
    expect(values.cadastralSection).toBe("B");
    expect(values.cadastralNumber).toBe("214/889");
    expect(topicBody(topic, { ...values, smokeDetectorsConfirmed: !values.smokeDetectorsConfirmed })).toEqual({
      smokeDetectorsConfirmed: !values.smokeDetectorsConfirmed,
    });
  });

  it("opens the guarantee on its reception date and never sends a date nobody typed", () => {
    const card = buildPortfolio(demo).find((c) => c.property.id === "p-bertrange")!;
    const leaseId = card.lots.find((l) => l.lease)!.lease!.id;
    const guarantee = (receivedOn: string | null): DemoData => ({
      ...demo,
      DEPOSITS: [
        ...demo.DEPOSITS.filter((x) => x.leaseId !== leaseId),
        { id: "dep-test", leaseId, form: "cash", amountCents: 250000, status: "held", receivedOn, entryEdlExists: true, deductions: [], releasedFirstTrancheCents: 0, releasedBalanceCents: 0 },
      ],
    });
    const dated = topicOf(menuOf(guarantee("2024-03-01"), "p-bertrange"), "deposit");
    expect(opened(dated).receivedOn).toBe("2024-03-01");
    expect(topicBody(dated, { ...opened(dated), status: "disputed" })).toEqual({ status: "disputed" });

    const undated = topicOf(menuOf(guarantee(null), "p-bertrange"), "deposit");
    expect(opened(undated).receivedOn).toBe("");
    expect(topicBody(undated, { ...opened(undated), amount: "3 000,00" })).toEqual({ amount: "3 000,00" });
  });

  it("opens a tenant on the stored parts of the name, and a company on its own name", () => {
    const card = buildPortfolio(demo).find((c) => c.property.id === "p-bertrange")!;
    const tenantId = card.lots.find((l) => l.lease)!.lease!.tenantContactIds[0];
    const person: DemoData = {
      ...demo,
      CONTACTS: demo.CONTACTS.map((c) => (c.id === tenantId ? { ...c, kind: "natural", name: "Maria Dos Santos", firstName: "Maria", lastName: "Dos Santos", legalName: "" } : c)),
    };
    const personTopic = topicOf(menuOf(person, "p-bertrange"), "tenant-0");
    expect(opened(personTopic).firstName).toBe("Maria");
    expect(opened(personTopic).lastName).toBe("Dos Santos");
    // The two parts are one name: they travel together, and nothing else does.
    expect(topicBody(personTopic, { ...opened(personTopic), firstName: "Maria Luisa" })).toEqual({ firstName: "Maria Luisa", lastName: "Dos Santos" });
    expect(topicBody(personTopic, { ...opened(personTopic), phone: "+352 621 000 000" })).toEqual({ phone: "+352 621 000 000" });

    const company: DemoData = {
      ...demo,
      CONTACTS: demo.CONTACTS.map((c) => (c.id === tenantId ? { ...c, kind: "legal", name: "Boulangerie Schmit S.à r.l.", firstName: "", lastName: "", legalName: "Boulangerie Schmit S.à r.l." } : c)),
    };
    const companyTopic = topicOf(menuOf(company, "p-bertrange"), "tenant-0");
    expect(opened(companyTopic)).toEqual({ legalName: "Boulangerie Schmit S.à r.l.", email: opened(companyTopic).email, phone: opened(companyTopic).phone });
    expect(topicBody(companyTopic, { ...opened(companyTopic), email: "contact@schmit.lu" })).toEqual({ email: "contact@schmit.lu" });
  });

  it("writes a company's name when it only exists as a person's two parts", () => {
    const card = buildPortfolio(demo).find((c) => c.property.id === "p-bertrange")!;
    const tenantId = card.lots.find((l) => l.lease)!.lease!.tenantContactIds[0];
    const data: DemoData = {
      ...demo,
      CONTACTS: demo.CONTACTS.map((c) => (c.id === tenantId ? { ...c, kind: "legal", name: "Boulangerie Schmit", firstName: "Boulangerie", lastName: "Schmit", legalName: "" } : c)),
    };
    const topic = topicOf(menuOf(data, "p-bertrange"), "tenant-0");
    expect(opened(topic).legalName).toBe("Boulangerie Schmit");
    expect(topicBody(topic, opened(topic))).toBeNull();
    expect(topicBody(topic, { ...opened(topic), phone: "+352 26 00 00 00" })).toEqual({
      legalName: "Boulangerie Schmit",
      firstName: "",
      lastName: "",
      phone: "+352 26 00 00 00",
    });
  });

  it("sends a whole form when it creates, with what the form does not show", () => {
    const topic: EditTopic = {
      id: "insurance",
      title: "Assurance",
      endpoint: "/api/assurances/create",
      method: "POST",
      extra: { leaseId: "l-1" },
      fields: [
        { kind: "text", name: "provider", label: "Assureur", value: "" },
        { kind: "date", name: "expiresOn", label: "Échéance", value: "" },
      ],
    };
    expect(topicBody(topic, { ...opened(topic), provider: "Foyer" })).toEqual({ leaseId: "l-1", provider: "Foyer", expiresOn: "" });
  });
});
