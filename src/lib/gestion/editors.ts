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
  /** A sentence under the form explaining what the change will do. */
  note?: string;
}

/** Editors that are not a flat form: they own their own small interface. */
export type SpecialEditor =
  | { kind: "photos"; propertyId: string; currentUrl: string | null }
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
