import type { DemoContact } from "@/lib/demo/data";
import type { EditField, EditTopic, MenuGroup } from "@/lib/gestion/editors";
import type { Dict } from "@/lib/i18n/fr";
import { LOCALES, LOCALE_LABELS } from "@/lib/i18n/config";

/**
 * What "Modifier" offers on a contact: who they are and how to reach them,
 * the account they pay from, and a note. The same editors, the same save
 * path and the same rule as on a property: each opens on what is stored and
 * writes only what the person changed.
 */

/**
 * Who the contact is and how to reach them, from the stored parts of the
 * name: a person's first and last name as they were typed ("Maria" and "Dos
 * Santos"), a company's own name in one field. The printed name is never
 * taken apart.
 */
export function contactTopic(d: Dict, contact: DemoContact, id: string, title: string, more: EditField[] = []): EditTopic {
  const reach: EditField[] = [
    { kind: "text", name: "email", label: d.location.email, value: contact.email ?? "", maxLength: 160, span: 2 },
    { kind: "text", name: "phone", label: d.location.phone, value: contact.phone ?? "", maxLength: 40, span: 2 },
    ...more,
  ];
  if (contact.kind === "legal") {
    return {
      id,
      title,
      endpoint: `/api/contacts/${contact.id}`,
      method: "PATCH",
      fields: [{ kind: "text", name: "legalName", label: d.modify.legalName, value: contact.legalName || contact.name, required: true, maxLength: 160, span: 2 }, ...reach],
      ...legalNameRule(contact),
    };
  }
  return {
    id,
    title,
    endpoint: `/api/contacts/${contact.id}`,
    method: "PATCH",
    fields: [
      { kind: "text", name: "firstName", label: d.location.firstName, value: contact.firstName ?? "", maxLength: 80 },
      { kind: "text", name: "lastName", label: d.location.lastName, value: contact.lastName ?? "", maxLength: 80 },
      ...reach,
    ],
    // The two parts make one name: the route refuses a person left with neither.
    together: [["firstName", "lastName"]],
  };
}

/**
 * A company recorded before it was said to be one has its name in the two
 * parts of a person's name and none of its own. The editor then shows that
 * name as the company's: it is written with every save, and the two parts it
 * came from are emptied, so the name on screen is the one that is stored.
 * A company that has its own name is left alone.
 */
export function legalNameRule(contact: DemoContact): Pick<EditTopic, "always" | "extra"> {
  if (contact.legalName) return {};
  const parts = Boolean(contact.firstName || contact.lastName);
  return { always: ["legalName"], ...(parts ? { extra: { firstName: "", lastName: "" } } : {}) };
}

export function contactMenu(contact: DemoContact, d: Dict): MenuGroup[] {
  // The languages a contact can be written to in; one stored outside the list still shows as it is.
  const languages = [
    ...LOCALES.map((l) => ({ value: l as string, label: LOCALE_LABELS[l] })),
    ...((LOCALES as readonly string[]).includes(contact.language) ? [] : [{ value: contact.language, label: contact.language.toUpperCase() }]),
  ];
  const language: EditField = { kind: "select", name: "language", label: d.common.language, value: contact.language, options: languages, span: 2 };
  return [
    {
      label: contact.name,
      entries: [
        { id: "identity", label: d.contacts.editIdentity, topic: contactTopic(d, contact, "identity", d.contacts.editIdentity, [language]) },
        {
          id: "bank",
          label: d.contacts.bankTitle,
          topic: {
            id: "bank",
            title: d.contacts.bankTitle,
            endpoint: `/api/contacts/${contact.id}`,
            method: "PATCH",
            fields: [
              { kind: "text", name: "iban", label: d.location.payerIban, value: contact.iban ?? "", maxLength: 40, mono: true, span: 2 },
              { kind: "text", name: "bankHolderName", label: d.location.payerName, value: contact.bankHolderName ?? "", maxLength: 120, span: 2 },
            ],
          },
        },
        {
          id: "notes",
          label: d.shell.fieldNote,
          topic: {
            id: "notes",
            title: d.shell.fieldNote,
            endpoint: `/api/contacts/${contact.id}`,
            method: "PATCH",
            fields: [{ kind: "textarea", name: "notes", label: d.shell.fieldNote, value: contact.notes ?? "", maxLength: 2000, span: 2 }],
          },
        },
      ],
    },
  ];
}
