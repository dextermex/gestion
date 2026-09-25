import type { ExistingDocument, GenerateLabels } from "@/components/gestion/GenerateDocument";
import type { DemoGenerated } from "@/lib/demo/data";
import { fmt, type Locale } from "@/lib/i18n/config";
import type { Dict } from "@/lib/i18n/fr";
import { formatDate } from "@/lib/types";

/**
 * What a screen hands the document control: the dictionary's words for
 * producing, opening and every refusal, and the document already produced
 * for a record, dated in the reader's language. Said once here so the
 * seven screens that produce documents say the same thing.
 */
export function generateLabels(d: Dict): GenerateLabels {
  return {
    produce: d.documents.produce,
    produceAgain: d.documents.produceAgain,
    open: d.common.open,
    producedOn: d.documents.producedOn,
    produced: d.documents.produced,
    errTemplate: d.documents.errTemplate,
    errSettings: d.documents.errSettings,
    errFieldName: d.documents.errFieldName,
    errFieldAddress: d.documents.errFieldAddress,
    errFieldPayment: d.documents.errFieldPayment,
    errNotReady: d.documents.errNotReady,
    reasonUnpaid: d.documents.reasonUnpaid,
    reasonKeysOut: d.documents.reasonKeysOut,
    reasonUnsealed: d.documents.reasonUnsealed,
    reasonNoContent: d.documents.reasonNoContent,
    errFailed: d.documents.errFailed,
  };
}

export function existingOf(g: DemoGenerated | null, d: Dict, locale: Locale): ExistingDocument | null {
  return g ? { documentId: g.documentId, name: g.name, producedLabel: fmt(d.documents.producedOn, { date: formatDate(g.generatedAt, locale) }) } : null;
}

/** The first characters of a fingerprint: enough to compare by eye, never the proof itself. */
export function shortSha(sha256: string | null | undefined): string {
  return sha256 ? sha256.slice(0, 12) : "";
}
