/**
 * The one CSV writer: UTF-8 with a byte-order mark so Excel in Luxembourg
 * opens it as is, a semicolon between fields (the decimal comma makes the
 * comma unusable), every field quoted when it carries a separator, a
 * quote or a line break. Amounts are written twice, in cents as the books
 * keep them and in euros as a person reads them.
 */
export type CsvCell = string | number;

/**
 * A spreadsheet reads a cell that begins with =, +, - or @ as a formula. A
 * name somebody typed (a property, an owner, a line's label) is text: it is
 * written with a leading apostrophe, which the spreadsheet shows as text
 * and does not compute. A figure this file wrote itself ("-12,50") stays a
 * figure.
 */
function asText(s: string): string {
  return /^[=+\-@\t\r]/.test(s) && !/^[+-]?\d+([.,]\d+)?$/.test(s) ? `'${s}` : s;
}

function escape(v: CsvCell): string {
  const s = typeof v === "number" ? String(v) : asText(v);
  return /[";\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function csvDocument(rows: ReadonlyArray<ReadonlyArray<CsvCell>>): string {
  return "﻿" + rows.map((r) => r.map(escape).join(";")).join("\r\n") + "\r\n";
}

/** Cents as a spreadsheet reads euros: a decimal comma, no thousands separator, no symbol. */
export function csvEuros(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)},${String(abs % 100).padStart(2, "0")}`;
}

/** A file name a browser keeps: letters, digits, spaces, middots and dashes only. */
export function safeFileName(name: string): string {
  return name
    .normalize("NFKC")
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}
