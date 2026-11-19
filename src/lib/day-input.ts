/**
 * A day as a person types it in this product: day, month, year, in that
 * order, whatever the browser's own language. The browser's date field
 * prints in the browser's format ("08/23/2026" on an English one), which
 * reads as a wrong date here; this one always reads 23/08/2026.
 */

/** "2026-08-23" as "23/08/2026"; anything else as nothing. */
export function dayToText(iso: string | null | undefined): string {
  return iso && /^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : "";
}

/** What was typed, as an ISO day, when it is a real one: "23/08/2026", "23.8.2026" and "23 08 2026" all are. */
export function parseDay(text: string): string | null {
  const m = text.trim().match(/^(\d{1,2})[/.\- ](\d{1,2})[/.\- ](\d{4})$/);
  if (!m) return null;
  const day = Number(m[1]);
  const month = Number(m[2]);
  const year = Number(m[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Digits typed in a row take their slashes as they come ("23082026" reads 23/08/2026); a hand-typed separator is left alone. */
export function maskDay(text: string): string {
  if (/[^\d]/.test(text.replace(/\//g, ""))) return text.slice(0, 10);
  const digits = text.replace(/\D/g, "").slice(0, 8);
  if (text.endsWith("/") && (digits.length === 2 || digits.length === 4)) return digits.length === 2 ? `${digits}/` : `${digits.slice(0, 2)}/${digits.slice(2)}/`;
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
}
