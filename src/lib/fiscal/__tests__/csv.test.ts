import { describe, expect, it } from "vitest";
import { csvDocument, csvEuros } from "@/lib/fiscal/csv";

/** The single cell of a one-row document, without the BOM and the trailing CRLF. */
const cell = (v: string | number): string => csvDocument([[v]]).replace(/^﻿/, "").replace(/\r\n$/, "");

/**
 * A fiscal export opens in Excel/LibreOffice: a cell a person typed must not
 * run as a formula. Leads (= + - @ TAB CR) are neutralised with a tick, while
 * genuine numbers — including the negative amounts csvEuros writes — are left
 * exactly as the books keep them.
 */
describe("csv formula neutralisation", () => {
  it("prefixes a tick to a formula lead in a text cell", () => {
    expect(cell("=1+2")).toBe("'=1+2");
    expect(cell("+1+1")).toBe("'+1+1");
    expect(cell("-1+1")).toBe("'-1+1");
    expect(cell("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(cell('=HYPERLINK("http://evil")')).toBe('"\'=HYPERLINK(""http://evil"")"');
  });

  it("leaves numbers and euro amounts untouched", () => {
    expect(cell(csvEuros(-12345))).toBe("-123,45");
    expect(cell(csvEuros(50))).toBe("0,50");
    expect(cell(-5)).toBe("-5");
    expect(cell("1234,45")).toBe("1234,45");
    expect(cell("1250")).toBe("1250");
  });
});
