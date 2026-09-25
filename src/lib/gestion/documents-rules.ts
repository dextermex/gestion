/**
 * What a document of the workspace is: its class (the register it belongs
 * to), the retention clock that class carries, and the file types the
 * private bucket accepts for it. Pure, so the routes and the screens agree.
 */
export const DOCUMENT_CLASSES = [
  "lease", "edl", "invoice", "receipt", "deed", "loan", "subsidy", "id_document",
  "decompte", "registered_letter", "insurance", "bank_statement", "tax", "photo", "other",
] as const;
export type DocumentClass = (typeof DOCUMENT_CLASSES)[number];

export type RetentionClass = "accounting_10y" | "aml_5y_from_end" | "applicant_3m" | "gdpr_minimised" | "permanent";

/** The retention clock a class carries: deeds forever, identity papers on the AML clock, the rest ten years. */
export function retentionFor(klass: DocumentClass): RetentionClass {
  if (klass === "deed") return "permanent";
  if (klass === "id_document") return "aml_5y_from_end";
  if (klass === "photo") return "gdpr_minimised";
  return "accounting_10y";
}

/** The file types a cabinet's pieces may take, and the extension each is stored under. */
export const DOCUMENT_TYPES: Record<string, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/avif": "avif",
  "text/csv": "csv",
  "application/vnd.ms-excel": "xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
};

export const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;

/** The entities a piece may hang off, and the table each lives in. */
export const RELATED_TABLES: Record<string, string> = {
  property: "properties",
  unit: "units",
  lease: "leases",
  contact: "contacts",
  ticket: "tickets",
  deposit_deduction: "deposit_deductions",
  work_order: "work_orders",
  bill: "bills",
};

/** A file's name as the register keeps it: trimmed, bounded, never empty. */
export function documentName(raw: string, fallback: string): string {
  const name = raw.trim().replace(/[\u0000-\u001f]/g, "").slice(0, 160);
  return name || fallback;
}
