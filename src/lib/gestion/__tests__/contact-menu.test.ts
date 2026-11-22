import { describe, expect, it } from "vitest";
import type { DemoContact } from "@/lib/demo/data";
import { contactMenu } from "@/lib/gestion/contact-menu";
import { initialValues, topicBody, type EditTopic, type MenuGroup } from "@/lib/gestion/editors";
import { fr } from "@/lib/i18n/fr";

/**
 * A contact is corrected from its own sheet. Each editor opens on what is
 * stored and writes only what changed, like the editors of a property.
 */
const person: DemoContact = {
  id: "c-1",
  kind: "natural",
  name: "Maria Dos Santos",
  firstName: "Maria",
  lastName: "Dos Santos",
  email: "maria@example.lu",
  phone: null,
  language: "pt",
  roles: ["tenant"],
  iban: "LU280019400644750000",
};
const company: DemoContact = { id: "c-2", kind: "legal", name: "Boulangerie Schmit S.à r.l.", legalName: "Boulangerie Schmit S.à r.l.", email: null, phone: "+352 26 00 00 00", language: "fr", roles: ["tenant"] };

const topic = (groups: MenuGroup[], id: string): EditTopic => {
  const entry = groups[0].entries.find((e) => e.id === id)!;
  if (!("topic" in entry)) throw new Error(id);
  return entry.topic;
};

describe("the editors of a contact", () => {
  it("open a person on the stored parts of the name and a company on its own name", () => {
    const p = initialValues(topic(contactMenu(person, fr), "identity"));
    expect(p).toMatchObject({ firstName: "Maria", lastName: "Dos Santos", email: "maria@example.lu", phone: "" });
    const c = initialValues(topic(contactMenu(company, fr), "identity"));
    expect(c.legalName).toBe("Boulangerie Schmit S.à r.l.");
    expect("firstName" in c).toBe(false);
  });

  it("show a language stored outside the four as it is, and do not rewrite it", () => {
    const identity = topic(contactMenu(person, fr), "identity");
    const language = identity.fields.find((f) => f.name === "language")!;
    expect(language.kind === "select" && language.options.map((o) => o.value)).toEqual(["fr", "en", "de", "lu", "pt"]);
    expect(initialValues(identity).language).toBe("pt");
    expect(topicBody(identity, { ...initialValues(identity), phone: "+352 621 000 000" })).toEqual({ phone: "+352 621 000 000" });
  });

  it("open the bank details and the note on what is stored, and save one without the other", () => {
    const bank = topic(contactMenu(person, fr), "bank");
    expect(initialValues(bank)).toEqual({ iban: "LU280019400644750000", bankHolderName: "" });
    expect(topicBody(bank, { ...initialValues(bank), bankHolderName: "Maria Dos Santos" })).toEqual({ bankHolderName: "Maria Dos Santos" });
    const notes = topic(contactMenu(person, fr), "notes");
    expect(topicBody(notes, initialValues(notes))).toBeNull();
  });

  it("write every editor to the contact's own route", () => {
    for (const entry of contactMenu(company, fr)[0].entries) {
      expect("topic" in entry && entry.topic.endpoint).toBe("/api/contacts/c-2");
      expect("topic" in entry && entry.topic.method).toBe("PATCH");
    }
  });
});
