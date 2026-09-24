import { describe, expect, it } from "vitest";
import { detectDelimiter, normaliseIban, parseAmountCents, parseDateIso, parseStatementCsv } from "@/lib/banking/csv";

/**
 * Bank statements as the banks export them: the parser must read a BCEE-style
 * export with separate credit and debit columns, a BGL-style one with a
 * signed amount, German and English headers, every European amount notation,
 * quoted fields with the delimiter inside, and give each operation an id
 * that survives a second import of the same file.
 */
describe("amounts", () => {
  it("reads every European notation as cents", () => {
    expect(parseAmountCents("1.234,56")).toBe(123456);
    expect(parseAmountCents("1234.56")).toBe(123456);
    expect(parseAmountCents("1234,56")).toBe(123456);
    expect(parseAmountCents("-1 234,56")).toBe(-123456);
    expect(parseAmountCents("1'234.56")).toBe(123456);
    expect(parseAmountCents("1234,56-")).toBe(-123456);
    expect(parseAmountCents("(12,00)")).toBe(-1200);
    expect(parseAmountCents("EUR 12,5")).toBe(1250);
    expect(parseAmountCents("+1670")).toBe(167000);
    expect(parseAmountCents("1.234")).toBe(123400);
    expect(parseAmountCents("1,234")).toBe(123400);
    expect(parseAmountCents("12.345,6")).toBe(1234560);
    expect(parseAmountCents("0,5")).toBe(50);
    expect(parseAmountCents("")).toBeNull();
    expect(parseAmountCents("abc")).toBeNull();
  });
});

describe("dates", () => {
  it("reads ISO, day-first and compact orders", () => {
    expect(parseDateIso("2026-08-03")).toBe("2026-08-03");
    expect(parseDateIso("03/08/2026")).toBe("2026-08-03");
    expect(parseDateIso("03.08.2026")).toBe("2026-08-03");
    expect(parseDateIso("03-08-26")).toBe("2026-08-03");
    expect(parseDateIso("20260803")).toBe("2026-08-03");
    expect(parseDateIso("2026-08-03T10:00:00")).toBe("2026-08-03");
    expect(parseDateIso("31/02/2026")).toBeNull();
    expect(parseDateIso("hier")).toBeNull();
  });
});

describe("ibans and delimiters", () => {
  it("normalises an IBAN and rejects what is not one", () => {
    expect(normaliseIban("lu28 0019 4006 4475 0000")).toBe("LU280019400644750000");
    expect(normaliseIban("Jean Muller")).toBeNull();
    expect(normaliseIban("")).toBeNull();
  });
  it("detects the delimiter from the header", () => {
    expect(detectDelimiter("Date;Montant;Contrepartie")).toBe(";");
    expect(detectDelimiter("Date,Amount,\"Counterparty, name\"")).toBe(",");
    expect(detectDelimiter("Datum\tBetrag\tName")).toBe("\t");
  });
});

describe("statements", () => {
  it("reads a BCEE-style export with credit and debit columns, in French", () => {
    const csv = [
      "Date d'opération;Date valeur;Libellé;Crédit;Débit;Contrepartie;IBAN contrepartie",
      "03/08/2026;03/08/2026;RF18 0000 4A 3B 0001 loyer aout;1.670,00;;JEAN MULLER;LU12 0001 2345 6789 1",
      "05/08/2026;05/08/2026;Facture électricité;;89,90;CREOS;LU98 0000 0000 0000 0000",
      "",
    ].join("\n");
    const { rows, skipped, delimiter } = parseStatementCsv(csv);
    expect(delimiter).toBe(";");
    expect(skipped).toBe(0);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ bookedOn: "2026-08-03", amountCents: 167000, counterpartyName: "JEAN MULLER", counterpartyIban: "LU120001234567891", remittanceInfo: "RF18 0000 4A 3B 0001 loyer aout", reference: null });
    expect(rows[1]).toMatchObject({ bookedOn: "2026-08-05", amountCents: -8990, counterpartyName: "CREOS" });
  });

  it("reads a signed-amount export with a bank reference, in English, quoted fields included", () => {
    const csv = [
      "﻿Booking date,Amount,Currency,Counterparty name,Counterparty IBAN,Remittance information,Transaction id",
      '2026-09-01,"1,400.00",EUR,"Santos, Ana",LU980020009876543210,"Loyer septembre, apt 2A",TX-0001',
      '2026-09-02,-45.10,EUR,"Post Luxembourg",,"Facture",TX-0002',
    ].join("\r\n");
    const { rows } = parseStatementCsv(csv);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ bookedOn: "2026-09-01", amountCents: 140000, counterpartyName: "Santos, Ana", remittanceInfo: "Loyer septembre, apt 2A", reference: "TX-0001", txId: "TX-0001" });
    expect(rows[1].counterpartyIban).toBeNull();
    expect(rows[1].txId).toBe("TX-0002");
  });

  it("reads a German export", () => {
    const csv = "Buchungstag;Betrag;Auftraggeber/Empfänger;IBAN;Verwendungszweck\n01.09.2026;1.250,00;Max Weber;DE89370400440532013000;Miete September\n";
    const { rows } = parseStatementCsv(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ bookedOn: "2026-09-01", amountCents: 125000, counterpartyName: "Max Weber", counterpartyIban: "DE89370400440532013000", remittanceInfo: "Miete September" });
  });

  it("gives identical lines distinct ids that survive a second import, and skips lines without a date or an amount", () => {
    const csv = ["Date;Montant;Contrepartie;Communication", "01/09/2026;700,00;A;loyer", "01/09/2026;700,00;A;loyer", ";700,00;A;loyer", "01/09/2026;;A;loyer", "01/09/2026;0,00;A;rien"].join("\n");
    const first = parseStatementCsv(csv);
    const second = parseStatementCsv(csv);
    expect(first.rows).toHaveLength(2);
    expect(first.skipped).toBe(3);
    expect(first.rows[0].txId).not.toBe(first.rows[1].txId);
    expect(first.rows.map((r) => r.txId)).toEqual(second.rows.map((r) => r.txId));
    expect(first.rows[0].txId.startsWith("csv:")).toBe(true);
  });

  it("returns nothing, and counts the lines, when no date or amount column can be found", () => {
    const { rows, skipped } = parseStatementCsv("Nom;Ville\nJean;Strassen\nAna;Esch\n");
    expect(rows).toEqual([]);
    expect(skipped).toBe(2);
  });
});
