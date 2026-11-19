/**
 * The shape of a focused editor.
 *
 * "Modifier" opens one small form at a time, never a settings screen. Each
 * form is described here as data — which fields, their current values, where
 * to send them — and built on the server, which is the only place that knows
 * both the row and the language. The client owns the modal and the save, so
 * there is exactly one save path and every editor behaves identically.
 */

export type EditField =
  | { kind: "text"; name: string; label: string; value: string; hint?: string; required?: boolean; maxLength?: number; placeholder?: string; mono?: boolean; span?: 1 | 2 }
  | { kind: "number"; name: string; label: string; value: string; hint?: string; span?: 1 | 2 }
  | { kind: "euro"; name: string; label: string; value: string; hint?: string; span?: 1 | 2 }
  | { kind: "date"; name: string; label: string; value: string; hint?: string; span?: 1 | 2 }
  | { kind: "select"; name: string; label: string; value: string; options: Array<{ value: string; label: string }>; hint?: string; span?: 1 | 2 }
  | { kind: "toggle"; name: string; label: string; value: boolean; span?: 1 | 2 }
  | { kind: "textarea"; name: string; label: string; value: string; maxLength?: number; span?: 1 | 2 };

/** A form-shaped editor: fields in, one PATCH out. */
export interface EditTopic {
  id: string;
  title: string;
  endpoint: string;
  method: "PATCH" | "POST";
  fields: EditField[];
  /** Values the form does not show but the endpoint needs, such as the
   *  property a new policy attaches to. Merged into the body on save. */
  extra?: Record<string, string>;
  /** Fields the endpoint writes as one, such as the parts of an address (a
   *  single column, replaced whole): when one of them changed, all are sent. */
  together?: string[][];
  /** Fields sent with every save, changed or not: what the form shows of
   *  them is not stored yet and has to be written to exist. */
  always?: string[];
  /** A sentence under the form explaining what the change will do. */
  note?: string;
}

export type EditValues = Record<string, string | boolean>;

/** What an editor opens on: the stored value of every field. */
export function initialValues(topic: EditTopic): EditValues {
  return Object.fromEntries(topic.fields.map((f) => [f.name, f.kind === "toggle" ? f.value : String(f.value)]));
}

/**
 * What a save sends.
 *
 * A creation sends the whole form. An edit sends what the person changed and
 * nothing else: a field left as it opened is never written back, so
 * correcting a name cannot rewrite an address, and a date nobody retyped is
 * not sent empty. Null when nothing changed: there is nothing to save.
 */
export function topicBody(topic: EditTopic, values: EditValues): EditValues | null {
  const opened = initialValues(topic);
  const read = (name: string) => values[name] ?? opened[name];
  if (topic.method === "POST") {
    return { ...(topic.extra ?? {}), ...Object.fromEntries(topic.fields.map((f) => [f.name, read(f.name)])) };
  }
  const same = (a: string | boolean, b: string | boolean) =>
    typeof a === "string" && typeof b === "string" ? a.trim() === b.trim() : a === b;
  const changed = new Set(topic.fields.filter((f) => !same(read(f.name), opened[f.name])).map((f) => f.name));
  if (changed.size === 0) return null;
  for (const group of topic.together ?? []) {
    if (group.some((name) => changed.has(name))) for (const name of group) changed.add(name);
  }
  for (const name of topic.always ?? []) changed.add(name);
  const body: EditValues = { ...(topic.extra ?? {}) };
  for (const f of topic.fields) if (changed.has(f.name)) body[f.name] = read(f.name);
  return body;
}

/** Editors that are not a flat form: they own their own small interface. */
export type SpecialEditor =
  | { kind: "photos"; propertyId: string; currentUrl: string | null; unitId?: string }
  | { kind: "payers"; leaseId: string; payers: string[] }
  | {
      kind: "indexation";
      leaseId: string;
      allowed: boolean;
      currentLabel: string;
      proposedLabel: string;
      reason: string | null;
    }
  | { kind: "archive"; propertyId: string; propertyName: string; blocked: boolean };

export type MenuEntry =
  | { id: string; label: string; topic: EditTopic }
  | { id: string; label: string; special: SpecialEditor }
  | { id: string; label: string; href: string };

export interface MenuGroup {
  label: string;
  entries: MenuEntry[];
}
