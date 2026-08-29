/**
 * Parse a human euro amount ("1 850", "1.850,50", "1850.50") into integer
 * cents. Returns null for anything that does not read as a positive amount —
 * money is integer cents everywhere, so the parse happens exactly once, here.
 */
export function parseEuroInput(raw: string): number | null {
  const cleaned = raw.replace(/[\s  €]/g, "");
  if (cleaned === "") return null;
  let normalized = cleaned;
  const hasComma = cleaned.includes(",");
  const hasDot = cleaned.includes(".");
  if (hasComma && hasDot) {
    // The rightmost separator is the decimal mark; the other groups thousands.
    normalized =
      cleaned.lastIndexOf(",") > cleaned.lastIndexOf(".")
        ? cleaned.replace(/\./g, "").replace(",", ".")
        : cleaned.replace(/,/g, "");
  } else if (hasComma) {
    normalized = cleaned.replace(",", ".");
  } else if (hasDot) {
    // A lone dot followed by exactly three digits reads as a thousands mark
    // ("1.850"); anything else is a decimal point ("1850.5").
    normalized = /^\d{1,3}\.\d{3}$/.test(cleaned) ? cleaned.replace(".", "") : cleaned;
  }
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return null;
  const cents = Math.round(parseFloat(normalized) * 100);
  return Number.isSafeInteger(cents) && cents > 0 ? cents : null;
}
