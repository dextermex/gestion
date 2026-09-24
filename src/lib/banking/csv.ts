import { createHash } from "node:crypto";

/**
 * A bank statement as the banks export it: one CSV, one line per operation,
 * a header naming the columns in the bank's own words. This parser reads the
 * exports Luxembourg banks and their neighbours produce without asking the
 * user to reshape anything: the delimiter is detected, the columns are found
 * by name in four languages, amounts come in every European notation, and
 * dates in the usual orders. A line without a date or an amount is skipped
 * and counted, never guessed.
 *
 * Every operation gets a stable id so a statement imported twice lands once:
 * the bank's own reference when the export carries one, else a hash of the
 * line plus its rank among identical lines in the same file.
 */

export interface StatementRow {
  bookedOn: string; // ISO date
  amountCents: number;
  counterpartyName: string;
  counterpartyIban: string | null;
  remittanceInfo: string;
  /** The bank's own reference for the operation, when the export has one. */
  reference: string | null;
  /** Stable across re-imports of the same file (see above). */
  txId: string;
}

export interface StatementParse {
  rows: StatementRow[];
  /** Lines with no usable date or amount. */
  skipped: number;
  delimiter: string;
  columns: Partial<Record<Column, number>>;
}

type Column = "date" | "amount" | "credit" | "debit" | "counterparty" | "iban" | "remittance" | "reference";

/** Header names the banks use, normalised (lower case, no accents, letters and digits only). */
const ALIASES: Record<Column, string[]> = {
  date: ["date", "datedoperation", "dateoperation", "dateexecution", "executiondate", "bookingdate", "bookeddate", "transactiondate", "datedetransaction", "buchungsdatum", "buchungstag", "datum", "datecomptable", "accountingdate", "datedecomptabilisation", "datevaleur", "valuedate", "valutadatum"],
  amount: ["montant", "montanteur", "amount", "amounteur", "betrag", "betrageur", "somme", "total"],
  credit: ["credit", "crediteur", "creditamount", "montantcredit", "haben", "gutschrift", "entree", "entrees", "recette"],
  debit: ["debit", "debiteur", "debitamount", "montantdebit", "soll", "lastschrift", "sortie", "sorties", "depense"],
  counterparty: ["contrepartie", "nomdelacontrepartie", "nomcontrepartie", "counterparty", "counterpartyname", "nom", "name", "beneficiaire", "donneurdordre", "auftraggeber", "auftraggeberempfanger", "empfanger", "payer", "payee", "partner", "partnername", "gegenpartei", "tiers", "libellecontrepartie"],
  iban: ["iban", "ibancontrepartie", "ibandelacontrepartie", "counterpartyiban", "partneriban", "gegenkontoiban", "ibanbeneficiaire", "ibandonneurdordre", "compte", "comptecontrepartie", "account", "counterpartyaccount"],
  remittance: ["communication", "communications", "libelle", "libelleoperation", "remittance", "remittanceinfo", "remittanceinformation", "description", "verwendungszweck", "mitteilung", "details", "detail", "motif", "objet", "memo", "text", "buchungstext", "intitule", "message"],
  reference: ["reference", "referencebancaire", "referenceoperation", "transactionid", "bankreference", "endtoendid", "numero", "nr", "referenz", "id", "identifiant", "operationid"],
};

export function normaliseHeader(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/** Splits CSV text into records, honouring quotes (with doubled quotes and embedded newlines). */
export function tokenise(text: string, delimiter: string): string[][] {
  const records: string[][] = [];
  let record: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') {
      quoted = true;
    } else if (ch === delimiter) {
      record.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      record.push(field);
      field = "";
      if (record.some((f) => f.trim() !== "")) records.push(record);
      record = [];
    } else field += ch;
  }
  record.push(field);
  if (record.some((f) => f.trim() !== "")) records.push(record);
  return records;
}

/** The delimiter is whichever of the four candidates the header line uses most, outside quotes. */
export function detectDelimiter(firstLine: string): string {
  let best = ";";
  let bestCount = -1;
  for (const cand of [";", ",", "\t", "|"]) {
    let count = 0;
    let quoted = false;
    for (const ch of firstLine) {
      if (ch === '"') quoted = !quoted;
      else if (!quoted && ch === cand) count++;
    }
    if (count > bestCount) {
      best = cand;
      bestCount = count;
    }
  }
  return best;
}

/** "1.234,56", "1234.56", "-1 234,56", "1'234.56", "1234,56-", "(12,00)", "EUR 12,00" all read as cents. */
export function parseAmountCents(raw: string): number | null {
  let s = raw.replace(/[\s '’]/g, "").replace(/[A-Za-z€$]/g, "");
  if (s === "") return null;
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  if (s.endsWith("-")) {
    negative = true;
    s = s.slice(0, -1);
  }
  if (s.startsWith("-")) {
    negative = !negative;
    s = s.slice(1);
  } else if (s.startsWith("+")) s = s.slice(1);
  let intPart = s;
  let frac = "";
  const decimalAt = Math.max(s.lastIndexOf(","), s.lastIndexOf("."));
  if (decimalAt >= 0) {
    const tail = s.slice(decimalAt + 1);
    // The last separator is the decimal mark, except a lone one followed by
    // exactly three digits ("1.234", "1,234"): euro amounts never carry three
    // decimals, so that is a thousands mark.
    const thousandsMark = tail.length === 3 && (s.match(/[.,]/g) ?? []).length === 1;
    if (!thousandsMark) {
      intPart = s.slice(0, decimalAt);
      frac = tail;
    }
  }
  intPart = intPart.replace(/[.,]/g, "");
  if (!/^\d*$/.test(intPart) || !/^\d{0,2}$/.test(frac)) return null;
  if (intPart === "" && frac === "") return null;
  const cents = Number(intPart || "0") * 100 + Number((frac + "00").slice(0, 2));
  return negative ? -cents : cents;
}

/** ISO, European (day first) and compact orders; two-digit years read as this century. */
export function parseDateIso(raw: string): string | null {
  const s = raw.trim().slice(0, 10).trim();
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (m) return iso(m[1], m[2], m[3]);
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  if (m) return iso(m[3], m[2], m[1]);
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2})$/);
  if (m) return iso(`20${m[3]}`, m[2], m[1]);
  m = s.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m) return iso(m[1], m[2], m[3]);
  return null;
}

function iso(y: string, mo: string, d: string): string | null {
  const year = Number(y);
  const month = Number(mo);
  const day = Number(d);
  if (year < 1990 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function normaliseIban(raw: string): string | null {
  const s = raw.replace(/\s/g, "").toUpperCase();
  return /^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(s) ? s : null;
}

function findColumns(header: string[]): Partial<Record<Column, number>> {
  const norm = header.map(normaliseHeader);
  const out: Partial<Record<Column, number>> = {};
  for (const col of Object.keys(ALIASES) as Column[]) {
    // Aliases are ordered from the most specific name to the loosest: the first hit wins.
    for (const alias of ALIASES[col]) {
      const idx = norm.findIndex((h, i) => h === alias && !Object.values(out).includes(i));
      if (idx >= 0) {
        out[col] = idx;
        break;
      }
    }
  }
  return out;
}

export function parseStatementCsv(text: string): StatementParse {
  const body = text.replace(/^﻿/, "");
  const firstLine = body.split(/\r?\n/).find((l) => l.trim() !== "") ?? "";
  const delimiter = detectDelimiter(firstLine);
  const records = tokenise(body, delimiter);
  if (records.length === 0) return { rows: [], skipped: 0, delimiter, columns: {} };
  const columns = findColumns(records[0]);
  const hasAmount = columns.amount !== undefined || columns.credit !== undefined || columns.debit !== undefined;
  if (columns.date === undefined || !hasAmount) return { rows: [], skipped: Math.max(0, records.length - 1), delimiter, columns };

  const cell = (rec: string[], col: Column): string => (columns[col] === undefined ? "" : (rec[columns[col]!] ?? "").trim());
  const rows: StatementRow[] = [];
  let skipped = 0;
  const seen = new Map<string, number>();
  for (const rec of records.slice(1)) {
    const bookedOn = parseDateIso(cell(rec, "date"));
    let amountCents: number | null = null;
    if (columns.amount !== undefined) amountCents = parseAmountCents(cell(rec, "amount"));
    if (amountCents === null && (columns.credit !== undefined || columns.debit !== undefined)) {
      const credit = parseAmountCents(cell(rec, "credit"));
      const debit = parseAmountCents(cell(rec, "debit"));
      if (credit !== null || debit !== null) amountCents = Math.abs(credit ?? 0) - Math.abs(debit ?? 0);
    }
    if (!bookedOn || amountCents === null || amountCents === 0) {
      skipped++;
      continue;
    }
    const counterpartyName = cell(rec, "counterparty");
    const counterpartyIban = normaliseIban(cell(rec, "iban"));
    const remittanceInfo = cell(rec, "remittance");
    const reference = cell(rec, "reference") || null;
    const fingerprint = [bookedOn, amountCents, counterpartyName, counterpartyIban ?? "", remittanceInfo].join("|");
    const rank = (seen.get(fingerprint) ?? 0) + 1;
    seen.set(fingerprint, rank);
    const txId = reference ?? `csv:${createHash("sha256").update(`${fingerprint}|${rank}`).digest("hex").slice(0, 32)}`;
    rows.push({ bookedOn, amountCents, counterpartyName, counterpartyIban, remittanceInfo, reference, txId });
  }
  return { rows, skipped, delimiter, columns };
}
