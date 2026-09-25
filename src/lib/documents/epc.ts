/**
 * The EPC QR code (European Payments Council "SCT" quick response code,
 * guidelines v2): the payload a banking app scans to prefill a SEPA credit
 * transfer. Service tag, version, UTF-8, SCT, BIC (optional since v2), the
 * beneficiary's name as registered at the bank, the IBAN, the amount as
 * EURx.xx, no purpose code, then either a structured reference (the lease's
 * RF creditor reference) or free text, never both.
 */
export interface EpcInput {
  holderName: string;
  iban: string;
  bic?: string;
  amountCents: number;
  /** ISO 11649 creditor reference; when absent the text goes in the free field. */
  reference?: string;
  text?: string;
}

const clean = (s: string, max: number): string => s.replace(/[\r\n]+/g, " ").trim().slice(0, max);

export function epcPayload(input: EpcInput): string {
  const amount = `EUR${(Math.max(0, Math.round(input.amountCents)) / 100).toFixed(2)}`;
  const reference = input.reference ? clean(input.reference.replace(/\s+/g, ""), 35) : "";
  const text = reference ? "" : clean(input.text ?? "", 140);
  return ["BCD", "002", "1", "SCT", clean(input.bic ?? "", 11), clean(input.holderName, 70), clean(input.iban.replace(/\s+/g, ""), 34), amount, "", reference, text].join("\n");
}
