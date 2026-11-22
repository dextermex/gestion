/**
 * Parse a human euro amount ("1 850", "1.850,50", "1850.50") into integer
 * cents. Returns null for anything that does not read as a positive amount —
 * money is integer cents everywhere, so the parse happens exactly once, here.
 */
/**
 * The largest amount a row can hold: money columns are 32-bit integers of
 * cents (21 474 836,47 €). Anything above does not read as an amount here,
 * so it is refused as a typing error instead of failing in the database.
 */
export const MAX_CENTS = 2_147_483_647;

export function parseEuroInput(raw: string): number | null {
  const cleaned = raw.replace(/[\s\u00a0\u202f€]/g, "");
  if (cleaned === "") return null;
  // Thousands written in groups of three, the first group not starting with
  // zero: "1.250", "1.250.000", "12,500,000".
  const grouped = (int: string, sep: "." | ","): boolean => new RegExp(`^[1-9]\\d{0,2}(\\${sep}\\d{3})+$`).test(int);
  let normalized = cleaned;
  const hasComma = cleaned.includes(",");
  const hasDot = cleaned.includes(".");
  if (hasComma && hasDot) {
    // The rightmost separator is the decimal mark; the other groups thousands,
    // and only in groups of three.
    const decimalMark = cleaned.lastIndexOf(",") > cleaned.lastIndexOf(".") ? "," : ".";
    const thousands = decimalMark === "," ? "." : ",";
    const at = cleaned.lastIndexOf(decimalMark);
    const int = cleaned.slice(0, at);
    if (!/^\d+$/.test(int) && !grouped(int, thousands)) return null;
    normalized = `${int.split(thousands).join("")}.${cleaned.slice(at + 1)}`;
  } else if (hasComma) {
    // Several groups of three are thousands ("1,250,000"); a single comma is
    // the decimal mark ("1250,50"), and "1,250" stays ambiguous: refused below.
    normalized = grouped(cleaned, ",") && cleaned.split(",").length > 2 ? cleaned.replace(/,/g, "") : cleaned.replace(",", ".");
  } else if (hasDot) {
    // Dots in groups of three are thousands ("1.850", "1.250.000"); anything
    // else is a decimal point ("1850.5"). "0.500" is neither: refused below.
    normalized = grouped(cleaned, ".") ? cleaned.replace(/\./g, "") : cleaned;
  }
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return null;
  const cents = Math.round(parseFloat(normalized) * 100);
  return Number.isSafeInteger(cents) && cents > 0 && cents <= MAX_CENTS ? cents : null;
}

/** An amount typed as nothing or as zero ("", "0", "0,00"): no amount at all. */
export function isZeroAmount(raw: string): boolean {
  return /^0*([.,]0*)?$/.test(raw.replace(/[\s\u00a0\u202f€]/g, ""));
}
