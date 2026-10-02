import type { ExistingDocument, GenerateLabels } from "@/components/gestion/GenerateDocument";
import type { DemoGenerated } from "@/lib/demo/data";
import { INTL_LOCALE, fmt, type Locale } from "@/lib/i18n/config";
import type { Dict } from "@/lib/i18n/fr";
import { formatDate } from "@/lib/types";
import type { MissingLabels } from "./missing";

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
    reasonNoTenant: d.documents.reasonNoTenant,
    reasonAbroad: d.documents.reasonAbroad,
    incomplete: contractMissingLabels(d),
    errFailed: d.documents.errFailed,
    send: d.documents.send,
    sentTo: d.documents.sentTo,
    sendRecorded: d.documents.sendRecorded,
    sendNoRecipient: d.documents.sendNoRecipient,
    sendFailed: d.documents.sendFailed,
  };
}

/** How a contract's missing fields are named, and where each is filled in, in the reader's language. */
export function contractMissingLabels(d: Dict): MissingLabels {
  return {
    intro: d.contrats.errIdentity,
    fields: d.contrats.contractFields,
    where: {
      lessor: fmt(d.contrats.whereLessor, { page: d.reglages.title }),
      tenant: fmt(d.contrats.whereTenant, { menu: d.modify.trigger, entry: d.modify.tenantIdentity }),
      property: fmt(d.contrats.whereProperty, { menu: d.modify.trigger, entry: d.modify.technical }),
    },
    join: d.contrats.contractJoin,
  };
}

export function existingOf(g: DemoGenerated | null, d: Dict, locale: Locale): ExistingDocument | null {
  return g ? { documentId: g.documentId, name: g.name, producedLabel: fmt(d.documents.producedOn, { date: formatDate(g.generatedAt, locale) }) } : null;
}

/** The first characters of a fingerprint: enough to compare by eye, never the proof itself. */
export function shortSha(sha256: string | null | undefined): string {
  return sha256 ? sha256.slice(0, 12) : "";
}

/** A file's weight as the register prints it: kilobytes under a megabyte, one decimal above. */
export function sizeLabel(kb: number, locale: Locale): string {
  const units = locale === "fr" || locale === "lu" ? (["Ko", "Mo"] as const) : (["KB", "MB"] as const);
  return kb >= 1024
    ? `${(kb / 1024).toLocaleString(INTL_LOCALE[locale], { maximumFractionDigits: 1 })} ${units[1]}`
    : `${kb.toLocaleString(INTL_LOCALE[locale])} ${units[0]}`;
}
