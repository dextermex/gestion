/**
 * The one CSV writer: UTF-8 with a byte-order mark so Excel in Luxembourg
 * opens it as is, a semicolon between fields (the decimal comma makes the
 * comma unusable), every field quoted when it carries a separator, a
 * quote or a line break. Amounts are written twice, in cents as the books
 * keep them and in euros as a person reads them.
 */
export type CsvCell = string | number;

function escape(v: CsvCell): string {
  const s = String(v);
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
