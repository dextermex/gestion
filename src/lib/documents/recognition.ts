import { z } from "zod/v4";
import { DOCUMENT_CLASSES, type DocumentClass } from "@/lib/gestion/documents-rules";
import type { Locale } from "@/lib/i18n/config";

/**
 * What the reader says about a piece dropped into the register: its class,
 * a clean title, the facts a manager needs to find it again, and the record
 * it belongs to. The reader's answer is proposed, never applied: the person
 * confirms every field before the piece is stored. Pure: the model call
 * lives in recognise.ts, this file holds the shape, the prompt and the
 * checks the answer goes through before a screen sees it.
 */
export interface Recognition {
  klass: DocumentClass;
  title: string;
  summary: string;
  /** ISO day the document carries (issue, signature or statement date). */
  documentDate: string | null;
  /** The main amount, in euro cents. */
  amountCents: number | null;
  parties: string[];
  reference: string | null;
  /** One of the candidate records offered, or null. */
  relatedId: string | null;
  confidence: "high" | "medium" | "low";
}

/** Whether this deployment carries a key for the reader (server-side only; false in a browser). */
export function recognitionConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

export interface RecognitionCandidate {
  id: string;
  label: string;
}

/** The shape the model is asked to fill. Bounds are checked afterwards, not by the schema. */
export const RECOGNITION_SCHEMA = z.object({
  klass: z.enum(DOCUMENT_CLASSES).describe("The class of the document, one of the listed classes."),
  title: z.string().describe("A short clean title for the register, never the file name."),
  summary: z.string().describe("One sentence saying what the document is and what it settles."),
  document_date: z.string().nullable().describe("The date the document carries, YYYY-MM-DD, or null."),
  amount_cents: z.number().int().nullable().describe("The main amount in euro cents, or null."),
  parties: z.array(z.string()).describe("Up to four names of the people or companies involved."),
  reference: z.string().nullable().describe("The document's own number or reference, or null."),
  related_id: z.string().nullable().describe("The id of the matching candidate record, exactly as listed, or null."),
  confidence: z.enum(["high", "medium", "low"]),
});

const LANGUAGE: Record<Locale, string> = { fr: "French", en: "English", de: "German", lu: "Luxembourgish" };

export const RECOGNITION_SYSTEM =
  "You read documents for a Luxembourg property manager who files them in a property-management register. You answer only with the requested structure. You never invent a date, an amount or a party that the document does not carry.";

/** The instruction that goes with the file. */
export function recognitionPrompt(lang: Locale, candidates: RecognitionCandidate[]): string {
  const language = LANGUAGE[lang] ?? LANGUAGE.fr;
  const list = candidates.length > 0 ? candidates.map((c) => `- ${c.id}: ${c.label}`).join("\n") : "- (none)";
  return [
    "Classify the attached document and extract the facts a manager needs to find it again.",
    "",
    "Classes (pick exactly one):",
    "- lease: a bail (residential or commercial lease) or an avenant",
    "- edl: an état des lieux report (inventory of fixtures, entry or exit)",
    "- invoice: a supplier invoice or quote",
    "- receipt: a receipt or quittance for a payment",
    "- deed: a notarial deed, acte de vente, acte de base, VEFA contract",
    "- loan: a loan contract, amortisation table or mortgage offer",
    "- subsidy: a subsidy decision (Klimabonus, aide étatique)",
    "- id_document: identity or KYC papers (ID card, passport, RBE extract, UBO register, company statutes)",
    "- decompte: a décompte (charges statement, syndic statement, deposit settlement)",
    "- registered_letter: a registered letter (mise en demeure, résiliation) or its AR proof",
    "- insurance: an insurance policy or certificate",
    "- bank_statement: a bank statement or account extract",
    "- tax: a tax document (certificat d'intérêts, bulletin d'impôt, déclaration)",
    "- photo: a photograph",
    "- other: anything else (applications, correspondence, plans)",
    "",
    `title: in ${language}, under 80 characters: the kind of document, the counterparty or subject, and the period or date. Never the file name. Legal terms of art stay in French (bail, décompte, état des lieux, mise en demeure, quittance). No em dashes.`,
    `summary: one sentence in ${language}.`,
    "document_date: the date the document carries, as YYYY-MM-DD, or null.",
    "amount_cents: the main amount in euro cents as an integer (the total of an invoice, the rent of a lease, the balance of a statement), or null when there is none.",
    "parties: up to four names of the people or companies involved, as written.",
    "reference: the document's own number (invoice number, policy number, file reference), or null.",
    "related_id: the record the document belongs to, chosen from the candidates by matching an address, a property name, a lot or a person; the id exactly as listed, or null when none matches clearly.",
    "confidence: high when the class and title are certain, medium when plausible, low when the document is unreadable or ambiguous.",
    "",
    "Candidates:",
    list,
  ].join("\n");
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

function clean(v: unknown, max: number): string {
  return typeof v === "string" ? v.replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "";
}

function validDay(v: unknown): string | null {
  if (typeof v !== "string" || !DAY.test(v)) return null;
  const [y, m, d] = v.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d ? v : null;
}

/**
 * The model's answer, bounded and checked: an unknown class files as
 * "other", a record outside the candidates binds to nothing, a date that
 * is not a day and an amount that is not a sane integer are dropped. Null
 * when there is no answer to read.
 */
export function validateRecognition(raw: unknown, candidateIds: readonly string[]): Recognition | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const klass = (DOCUMENT_CLASSES as readonly string[]).includes(String(r.klass)) ? (r.klass as DocumentClass) : "other";
  const amount = typeof r.amount_cents === "number" && Number.isInteger(r.amount_cents) && r.amount_cents >= 0 && r.amount_cents <= 1e12 ? r.amount_cents : null;
  const parties = Array.isArray(r.parties)
    ? r.parties
        .map((p) => clean(p, 80))
        .filter(Boolean)
        .slice(0, 4)
    : [];
  const relatedId = typeof r.related_id === "string" && candidateIds.includes(r.related_id) ? r.related_id : null;
  const confidence = r.confidence === "high" || r.confidence === "medium" ? r.confidence : "low";
  return {
    klass,
    title: clean(r.title, 160),
    summary: clean(r.summary, 240),
    documentDate: validDay(r.document_date),
    amountCents: amount,
    parties,
    reference: clean(r.reference, 60) || null,
    relatedId,
    confidence,
  };
}
