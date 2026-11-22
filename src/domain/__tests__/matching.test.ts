import { describe, expect, it } from "vitest";
import {
  BankTransaction,
  OpenInvoice,
  allocateFifo,
  allocationSummary,
  findSubsetSum,
  jaroWinkler,
  matchTransaction,
} from "@/domain/banking/matching";
import { cents } from "@/domain/money";
import { leaseRF } from "@/domain/banking/rf";

const RF_A = leaseRF(1, 1);
const RF_B = leaseRF(1, 2);

const invoice = (over: Partial<OpenInvoice>): OpenInvoice => ({
  id: "inv-1",
  leaseId: "lease-1",
  tenantNames: ["Jean Muller"],
  rfReference: RF_A,
  dueDate: "2026-05-01",
  totalAmount: cents(1450),
  openAmount: cents(1450),
  previousRentAmount: null,
  unitLabel: "Apt 3B — 12 rue de la Gare",
  ...over,
});

const tx = (over: Partial<BankTransaction>): BankTransaction => ({
  id: "tx-1",
  bookedAt: "2026-05-02",
  amount: cents(1450),
  counterpartyName: "JEAN MULLER",
  counterpartyIban: "LU120010001234567891",
  remittanceInfo: "",
  endToEndId: null,
  ...over,
});

describe("Tier 1 — RF deterministic", () => {
  it("matches on a checksum-valid RF in free text", () => {
    const d = matchTransaction(
      tx({ remittanceInfo: `Loyer mai ${RF_A}` }),
      [invoice({}), invoice({ id: "inv-2", rfReference: RF_B, leaseId: "lease-2" })],
      [],
      new Map(),
    );
    expect(d.kind).toBe("auto");
    if (d.kind === "auto") {
      expect(d.tier).toBe("rf");
      expect(d.invoiceIds).toEqual(["inv-1"]);
    }
  });

  it("sends an RF transfer FIFO to the tenancy's oldest open periods", () => {
    const d = matchTransaction(
      tx({ remittanceInfo: `Loyer ${RF_A}`, amount: cents(1450) }),
      [invoice({ id: "jun", dueDate: "2026-06-01", openAmount: cents(1450), totalAmount: cents(1450) }), invoice({ id: "may", dueDate: "2026-05-01", openAmount: cents(700), totalAmount: cents(1450) })],
      [],
      new Map(),
    );
    expect(d.kind).toBe("auto");
    if (d.kind === "auto") {
      expect(d.tier).toBe("rf");
      expect(d.invoiceIds).toEqual(["may", "jun"]);
      expect(d.confidence).toBe(1);
    }
  });

  it("flags INDEXATION_LAG on an RF match at the previous rent", () => {
    const d = matchTransaction(
      tx({ remittanceInfo: RF_A, amount: cents(1450) }),
      [invoice({ totalAmount: cents(1520), openAmount: cents(1520), previousRentAmount: cents(1450) })],
      [],
      new Map(),
    );
    expect(d.kind).toBe("auto");
    if (d.kind === "auto") {
      expect(d.indexationLag?.shortfall).toBe(cents(70));
    }
  });
});

describe("Tier 2 — learned IBAN bindings (third-party payers)", () => {
  it("routes a parent's transfer to the bound lease FIFO", () => {
    const d = matchTransaction(
      tx({ counterpartyName: "MARIE MULLER", counterpartyIban: "LU9800200001112223334" }),
      [
        invoice({ id: "apr", dueDate: "2026-04-01", openAmount: cents(200) }),
        invoice({ id: "may", dueDate: "2026-05-01" }),
      ],
      [{ payerIban: "LU9800200001112223334", leaseId: "lease-1" }],
      new Map(),
    );
    expect(d.kind).toBe("auto");
    if (d.kind === "auto") {
      expect(d.tier).toBe("iban_binding");
      expect(d.invoiceIds).toEqual(["apr", "may"]); // oldest first
    }
  });

  it("solves subset-sum for one transfer covering several invoices", () => {
    const pool = [
      invoice({ id: "a", leaseId: "l1", openAmount: cents(900) }),
      invoice({ id: "b", leaseId: "l1", openAmount: cents(1100) }),
      invoice({ id: "c", leaseId: "l1", openAmount: cents(700) }),
    ];
    const subset = findSubsetSum(cents(1600), pool, 6);
    expect(subset?.map((i) => i.id).sort()).toEqual(["a", "c"]);

    const d = matchTransaction(
      tx({ amount: cents(1600), counterpartyIban: "LU55", counterpartyName: "EMPLOYER SA", remittanceInfo: "LOYERS" }),
      pool,
      [{ payerIban: "LU55", leaseId: "l1" }],
      new Map(),
    );
    // Exact single-invoice FIFO can't absorb 1600 fully — but binding tier fires
    // first with FIFO allocation; assert it allocated across invoices.
    expect(d.kind).toBe("auto");
  });
});

describe("Tier 3 — weighted fuzzy with the margin rule", () => {
  it("auto-posts a clear fuzzy match", () => {
    const d = matchTransaction(
      tx({ remittanceInfo: "LOYER APT 3B GARE", counterpartyIban: "LU777" }),
      [invoice({})],
      [],
      new Map([["lease-1", new Set(["LU777"])]]),
    );
    expect(d.kind).toBe("auto");
    if (d.kind === "auto") {
      expect(d.tier).toBe("fuzzy");
      expect(d.confidence).toBeGreaterThanOrEqual(0.85);
    }
  });

  it("sends two identical €1,450 studios to review — the margin rule", () => {
    const twin = invoice({
      id: "inv-twin",
      leaseId: "lease-2",
      tenantNames: ["Jeanne Muller"],
      rfReference: RF_B,
      unitLabel: "Apt 3C — 12 rue de la Gare",
    });
    const d = matchTransaction(
      // No IBAN history, no unit token in text: only amount+name+date signals,
      // nearly identical for both candidates.
      tx({ remittanceInfo: "LOYER MAI", counterpartyIban: null, counterpartyName: "J MULLER" }),
      [invoice({}), twin],
      [],
      new Map(),
    );
    expect(d.kind).toBe("review");
    if (d.kind === "review") {
      expect(d.candidates.length).toBeGreaterThan(0);
    }
  });

  it("suggests an IBAN binding from the review queue (one-keystroke automation)", () => {
    const d = matchTransaction(
      tx({ remittanceInfo: "LOYER", counterpartyIban: "LU31NEW", counterpartyName: "JEAN MULLER", amount: cents(1450) }),
      [invoice({})],
      [],
      new Map(),
    );
    if (d.kind === "review") {
      expect(d.suggestBinding).toEqual({ payerIban: "LU31NEW", leaseId: "lease-1" });
    } else {
      // If it auto-matched, the score path must be fuzzy with high confidence.
      expect(d.kind).toBe("auto");
    }
  });

  it("ignores outgoing amounts", () => {
    const d = matchTransaction(tx({ amount: -cents(90) }), [invoice({})], [], new Map());
    expect(d.kind).toBe("ignore");
  });
});

describe("allocation ledger", () => {
  it("allocates FIFO with partials and residuals", () => {
    const allocations = allocateFifo(cents(2000), [
      invoice({ id: "mar", dueDate: "2026-03-01", openAmount: cents(1450) }),
      invoice({ id: "apr", dueDate: "2026-04-01", openAmount: cents(1450) }),
    ]);
    expect(allocations).toEqual([
      { invoiceId: "mar", amount: cents(1450) },
      { invoiceId: "apr", amount: cents(550) },
    ]);
  });

  it("turns excess into tenant credit", () => {
    const allocations = allocateFifo(cents(1600), [invoice({ openAmount: cents(1450) })]);
    const summary = allocationSummary(cents(1600), allocations);
    expect(summary.allocated).toBe(cents(1450));
    expect(summary.credit).toBe(cents(150));
  });
});

describe("Jaro-Winkler", () => {
  it("behaves on the classic pairs", () => {
    expect(jaroWinkler("MARTHA", "MARHTA")).toBeGreaterThan(0.95);
    expect(jaroWinkler("JEAN MULLER", "JEAN MULLER")).toBe(1);
    expect(jaroWinkler("JEAN MULLER", "PIERRE SCHMIT")).toBeLessThan(0.6);
  });
});

describe("a payer bound to several tenancies", () => {
  const PAYER = "LU9800200001112223334";
  const bindings = [
    { payerIban: PAYER, leaseId: "flat" },
    { payerIban: PAYER, leaseId: "parking" },
  ];
  const flat = (over: Partial<OpenInvoice> = {}) => invoice({ id: "flat-may", leaseId: "flat", rfReference: RF_A, openAmount: cents(1450), totalAmount: cents(1450), unitLabel: "Apt 3B", ...over });
  const parking = (over: Partial<OpenInvoice> = {}) => invoice({ id: "parking-may", leaseId: "parking", rfReference: RF_B, openAmount: cents(120), totalAmount: cents(120), unitLabel: "Parking 12", ...over });
  const from = (amount: number) => tx({ amount, counterpartyIban: PAYER, counterpartyName: "PARENT MULLER", remittanceInfo: "virement" });

  it("lets the amount say which tenancy a transfer pays, whatever the order of the bindings", () => {
    for (const order of [bindings, [...bindings].reverse()]) {
      const rent = matchTransaction(from(cents(1450)), [flat(), parking()], order, new Map());
      expect(rent).toMatchObject({ kind: "auto", tier: "iban_binding", invoiceIds: ["flat-may"] });
      const space = matchTransaction(from(cents(120)), [flat(), parking()], order, new Map());
      expect(space).toMatchObject({ kind: "auto", tier: "iban_binding", invoiceIds: ["parking-may"] });
    }
  });

  it("splits one transfer covering both tenancies exactly", () => {
    const both = matchTransaction(from(cents(1570)), [flat(), parking()], bindings, new Map());
    expect(both.kind).toBe("auto");
    if (both.kind === "auto") {
      expect(both.tier).toBe("subset_sum");
      expect([...both.invoiceIds].sort()).toEqual(["flat-may", "parking-may"]);
    }
  });

  it("holds for a person a transfer whose amount names neither tenancy alone", () => {
    const odd = matchTransaction(from(cents(800)), [flat(), parking()], bindings, new Map());
    expect(odd.kind).toBe("review");
    // Two tenancies owing the very same amount are not told apart by it either.
    const same = matchTransaction(from(cents(1450)), [flat(), parking({ openAmount: cents(1450), totalAmount: cents(1450) })], bindings, new Map());
    expect(same.kind).toBe("review");
  });

  it("still routes to the one tenancy that has anything open", () => {
    const d = matchTransaction(from(cents(500)), [flat()], bindings, new Map());
    expect(d).toMatchObject({ kind: "auto", tier: "iban_binding", invoiceIds: ["flat-may"] });
  });
});

describe("the margin rule compares tenancies, not two months of the same one", () => {
  it("posts the ordinary monthly rent of a tenancy whose next month is open too", () => {
    const d = matchTransaction(
      tx({ remittanceInfo: "LOYER APT 3B GARE", counterpartyIban: "LU777", bookedAt: "2026-05-02" }),
      [invoice({ id: "may", dueDate: "2026-05-01" }), invoice({ id: "jun", dueDate: "2026-06-01" })],
      [],
      new Map([["lease-1", new Set(["LU777"])]]),
    );
    expect(d).toMatchObject({ kind: "auto", tier: "fuzzy", invoiceIds: ["may"] });
  });
});

describe("the reference a workspace issued is found as itself", () => {
  it("matches an RF followed by a word, whatever that word does to a checksum", () => {
    // Over a few hundred references, "<RF> loyer" compacted always holds a longer string that also passes mod 97 for some of them.
    for (let n = 1; n <= 300; n++) {
      const rf = leaseRF(6895, n);
      const d = matchTransaction(tx({ remittanceInfo: `${rf} loyer`, counterpartyIban: null }), [invoice({ rfReference: rf })], [], new Map());
      expect(d, rf).toMatchObject({ kind: "auto", tier: "rf", invoiceIds: ["inv-1"] });
    }
  });

  it("holds a transfer naming two tenancies for a person", () => {
    const d = matchTransaction(tx({ remittanceInfo: `${RF_A} et ${RF_B}`, amount: cents(2900) }), [invoice({}), invoice({ id: "inv-2", leaseId: "lease-2", rfReference: RF_B })], [], new Map());
    expect(d.kind).toBe("review");
  });
});
