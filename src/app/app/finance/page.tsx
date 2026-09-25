import { Badge, PageHeader } from "@/components/pro/ui";
import { LegalNote, Panel } from "@/components/gestion/bits";
import BillActions from "@/components/gestion/BillActions";
import BillUpload from "@/components/gestion/BillUpload";
import { getDemo, isSampleData } from "@/lib/demo";
import type { DemoData } from "@/lib/demo";
import { euros, formatDate } from "@/lib/types";
import { getI18n } from "@/lib/i18n";
import { fmt } from "@/lib/i18n/config";
import type { Dict } from "@/lib/i18n/fr";
import { billState, type BillCategory } from "@/lib/gestion/bills";
import { managementFeeVat } from "@/domain/fiscal/vat";
import { splitExact } from "@/domain/money";

/**
 * Finance: the bills the desk entered, each with its piece in the register
 * and its place in the fiscal buckets, paid or still due. The sample
 * cabinet also carries its worked example: the managed SCI's July
 * statement, fees and payout, computed by the engines over the sample
 * mandate. A real account has no such mandate yet and sees its own books.
 */

/** The sample mandate's statement: engine-computed, from records only a sample cabinet carries. */
function sampleStatement(demo: DemoData) {
  const { RENT_PERIODS, TICKETS, contactById, leaseById, unitById } = demo;
  const boilerTicket = TICKETS.find((t) => t.id === "t-1");
  if (!boilerTicket || RENT_PERIODS.length === 0) return null;
  const july = RENT_PERIODS.filter((rp) => rp.period === "2026-07");
  const beaulieuLeases = ["l-3b", "l-3c", "l-2a", "l-1a", "l-rdc"];
  const collectedRows = july.filter((rp) => beaulieuLeases.includes(rp.leaseId)).map((rp) => ({ rp, lease: leaseById(rp.leaseId) }));
  const collected = collectedRows.reduce((a, r) => a + r.rp.allocatedCents, 0);
  const feeNet = Math.round(collected * 0.04);
  const fee = managementFeeVat(feeNet, "2026-07-31");
  const krierInvoice = 124_000; // boiler repair, owner charge
  const netToOwner = collected - fee.gross - krierInvoice;
  // Co-owner split through the SCI (60/40): exact to the cent.
  const [faberShare, pierreShare] = splitExact(netToOwner, [60, 40]);
  return {
    collectedRows,
    fee,
    krierInvoice,
    netToOwner,
    faberShare,
    pierreShare,
    sci: contactById("c-sci-bealieu"),
    ownerA: contactById("c-faber"),
    ownerB: contactById("c-faber-p"),
    artisan: contactById("c-krier"),
    boilerTicket,
    unit3b: unitById("u-b-3b").label,
  };
}

function categoryLabels(d: Dict): Record<BillCategory, string> {
  return {
    maintenance_repairs: d.finance.billCatRepair,
    permanent_charges: d.finance.billCatUtilities,
    insurance: d.finance.billCatInsurance,
    management_fees: d.finance.billCatFees,
    impot_foncier: d.finance.billCatTax,
    debt_interest: d.finance.billCatInterest,
    other_frais: d.finance.billCatOther,
  };
}

export default async function FinancePage() {
  const { locale, d } = await getI18n();
  const demo = await getDemo();
  const sample = await isSampleData();
  const { BILLS, CONTACTS, ORG, TODAY, UNITS, propertyById } = demo;
  const writable = !sample;
  const sampleNote = sample ? fmt(d.shell.sampleBanner, { cabinet: ORG.shortName }) : null;

  const statement = sample ? sampleStatement(demo) : null;
  const suppliers = CONTACTS.filter((c) => c.roles.some((r) => r === "artisan" || r === "supplier" || r === "syndic")).map((c) => ({ id: c.id, name: c.name }));
  const unitOptions = UNITS.map((u) => ({ id: u.id, label: `${u.label} · ${propertyById(u.propertyId).name}` }));
  const ocr = statement
    ? {
        supplierId: statement.artisan.id,
        subject: statement.boilerTicket.title,
        docNo: "2026-0812",
        docDate: "2026-08-08",
        amountLabel: "1 240,00",
        unitId: "u-b-3b",
      }
    : null;

  const categories = categoryLabels(d);
  const STATE: Record<"paid" | "due" | "overdue", { label: string; color: string }> = {
    paid: { label: d.finance.billPaidState, color: "bg-emerald-100 text-emerald-800" },
    due: { label: d.finance.billDue, color: "bg-amber-100 text-amber-800" },
    overdue: { label: d.finance.billOverdue, color: "bg-red-100 text-red-700" },
  };
  const bills = [...BILLS].sort((a, b) => ((a.docDate ?? a.createdAt) < (b.docDate ?? b.createdAt) ? 1 : -1));

  return (
    <div>
      <PageHeader
        title={d.finance.title}
        subtitle={d.finance.subtitle}
        actions={
          <BillUpload d={d} inbox={ORG.billInbox} suppliers={suppliers} unitOptions={unitOptions} ocr={ocr} writable={writable} sampleNote={sampleNote} />
        }
      />

      {statement && (
      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <Panel title={fmt(d.finance.statementTitle, { sci: statement.sci.name })}>
            <div className="table-scroll">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-sand-100 bg-sand-50/60 text-left text-[11px] uppercase tracking-wide text-ink-soft">
                    <th className="px-3 py-2.5 font-semibold">{d.finance.colEntry}</th>
                    <th className="px-3 py-2.5 text-right font-semibold">{d.finance.colAmount}</th>
                  </tr>
                </thead>
                <tbody>
                  {statement.collectedRows.map(({ rp, lease }) => (
                    <tr key={rp.id} className="border-b border-sand-50">
                      <td className="px-3 py-2.5 text-ink">
                        {fmt(d.finance.rentCollected, { unit: demo.leaseUnitLabel(lease) })}
                        {rp.allocatedCents === 0 && (
                          <span className="ml-2 text-xs text-red-700">{d.finance.rentUnpaid}</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-ink">
                        {euros(rp.allocatedCents, locale)}
                      </td>
                    </tr>
                  ))}
                  <tr className="border-b border-sand-50">
                    <td className="px-3 py-2.5 text-ink">
                      {d.finance.feeLine}
                      <span className="ml-2 text-xs text-ink-soft">
                        {fmt(d.finance.feeDetail, { net: euros(statement.fee.net, locale), vat: euros(statement.fee.vat, locale) })}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-red-700">− {euros(statement.fee.gross, locale)}</td>
                  </tr>
                  <tr className="border-b border-sand-50">
                    <td className="px-3 py-2.5 text-ink">
                      {fmt(d.finance.invoiceLine, { artisan: statement.artisan.name, unit: statement.unit3b })}
                      <span className="ml-2 text-xs text-ink-soft">{d.finance.invoiceDetail}</span>
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-red-700">
                      − {euros(statement.krierInvoice, locale)}
                    </td>
                  </tr>
                  <tr className="bg-sand-50/60">
                    <td className="px-3 py-2.5 font-bold text-ink">{d.finance.netToOwner}</td>
                    <td className="px-3 py-2.5 text-right font-display font-bold tabular-nums text-emerald-700">
                      {euros(statement.netToOwner, locale)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-sand-200 p-3.5">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-soft">
                  {d.finance.sciSplit}
                </p>
                <ul className="mt-2 space-y-1.5 text-sm">
                  <li className="flex justify-between">
                    <span className="text-ink-soft">{statement.ownerA.name} · 60 %</span>
                    <span className="font-semibold tabular-nums text-ink">{euros(statement.faberShare, locale)}</span>
                  </li>
                  <li className="flex justify-between">
                    <span className="text-ink-soft">{statement.ownerB.name} · 40 %</span>
                    <span className="font-semibold tabular-nums text-ink">{euros(statement.pierreShare, locale)}</span>
                  </li>
                </ul>
                <p className="mt-2 text-[11px] text-ink-soft">{d.finance.sciSplitNote}</p>
              </div>
              <div className="rounded-xl border border-sand-200 p-3.5">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-soft">{d.finance.payout}</p>
                <p className="mt-2 text-sm text-ink">{d.finance.payoutBody}</p>
                <Badge className="mt-2 bg-emerald-100 text-emerald-800">{d.finance.payoutDone}</Badge>
              </div>
            </div>

            <LegalNote>{d.finance.feeLegal}</LegalNote>
          </Panel>
        </div>

        <div className="flex flex-col gap-5 lg:col-span-2">
          <Panel title={d.finance.trustTitle}>
            <ul className="space-y-2.5 text-sm">
              <li className="flex items-center justify-between gap-3">
                <span className="text-ink-soft">{d.finance.trustReceiving}</span>
                <Badge className="bg-emerald-100 text-emerald-800">{d.finance.trustActive}</Badge>
              </li>
              <li className="flex items-center justify-between gap-3">
                <span className="text-ink-soft">{d.finance.trustSyndicat}</span>
                <Badge className="bg-sand-100 text-ink-soft">RGD 1975 art. 28</Badge>
              </li>
              <li className="flex items-center justify-between gap-3">
                <span className="text-ink-soft">{d.finance.trustLedger}</span>
                <Badge className="bg-emerald-100 text-emerald-800">{d.finance.trustHeld}</Badge>
              </li>
            </ul>
            <LegalNote>{d.finance.trustLegal}</LegalNote>
          </Panel>

          <Panel title={d.finance.exportsTitle}>
            <ul className="space-y-2.5 text-sm">
              <li className="flex items-center justify-between gap-3">
                <div>
                  <p className="font-semibold text-ink">{d.finance.exportFaia}</p>
                  <p className="text-xs text-ink-soft">{d.finance.exportFaiaSub}</p>
                </div>
                <Badge className="bg-brand-100 text-brand-800">{d.finance.ready}</Badge>
              </li>
              <li className="flex items-center justify-between gap-3">
                <div>
                  <p className="font-semibold text-ink">{d.finance.exportPeppol}</p>
                  <p className="text-xs text-ink-soft">{d.finance.exportPeppolSub}</p>
                </div>
                <Badge className="bg-brand-100 text-brand-800">{d.finance.ready}</Badge>
              </li>
              <li className="flex items-center justify-between gap-3">
                <div>
                  <p className="font-semibold text-ink">{d.finance.exportPcn}</p>
                  <p className="text-xs text-ink-soft">{d.finance.exportPcnSub}</p>
                </div>
                <Badge className="bg-sand-100 text-ink-soft">{d.finance.mapped}</Badge>
              </li>
            </ul>
          </Panel>
        </div>
      </div>
      )}

      <div className={statement ? "mt-5" : ""}>
        <Panel title={d.finance.billsTitle}>
          {bills.length === 0 ? (
            <p className="text-sm text-ink-soft">{d.finance.billsNone}</p>
          ) : (
            <div className="table-scroll">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-sand-100 bg-sand-50/60 text-left text-[11px] uppercase tracking-wide text-ink-soft">
                    <th className="px-4 py-2.5 font-semibold">{d.finance.billsColDate}</th>
                    <th className="px-3 py-2.5 font-semibold">{d.finance.billsColBill}</th>
                    <th className="px-3 py-2.5 font-semibold">{d.finance.billsColUnit}</th>
                    <th className="px-3 py-2.5 text-right font-semibold">{d.finance.billsColAmount}</th>
                    <th className="px-4 py-2.5 text-right font-semibold">{d.finance.billsColStatus}</th>
                  </tr>
                </thead>
                <tbody>
                  {bills.map((bill) => {
                    const state = billState(bill, TODAY);
                    return (
                      <tr key={bill.id} className="border-b border-sand-50 last:border-0 hover:bg-sand-50/50" data-bill={bill.id}>
                        <td className="px-4 py-3 tabular-nums text-ink-soft">{formatDate(bill.docDate ?? bill.createdAt, locale)}</td>
                        <td className="px-3 py-3">
                          <p className="font-semibold text-ink">
                            {[bill.supplierName, bill.subject].filter(Boolean).join(" · ")}
                          </p>
                          <p className="text-xs text-ink-soft">
                            {[bill.docNo, categories[bill.category], bill.direction === "income" ? d.finance.billIncome : d.finance.billExpense].filter(Boolean).join(" · ")}
                            {bill.hasDocument && bill.documentId && (
                              <>
                                {" · "}
                                <a href={`/api/documents/${encodeURIComponent(bill.documentId)}/fichier`} className="font-semibold text-brand-700 hover:underline">
                                  {d.finance.billOpenDoc}
                                </a>
                              </>
                            )}
                          </p>
                        </td>
                        <td className="px-3 py-3 text-xs text-ink-soft">{bill.unitLabel || d.common.none}</td>
                        <td className="px-3 py-3 text-right">
                          <p className={"tabular-nums font-semibold " + (bill.direction === "income" ? "text-emerald-700" : "text-ink")}>
                            {euros(bill.amountCents, locale)}
                          </p>
                          {bill.vatCents > 0 && <p className="text-[11px] tabular-nums text-ink-soft">{fmt(d.finance.billVatOf, { vat: euros(bill.vatCents, locale) })}</p>}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex flex-col items-end gap-1.5">
                            <Badge className={STATE[state].color}>{STATE[state].label}</Badge>
                            {state !== "paid" && (
                              <BillActions
                                billId={bill.id}
                                todayISO={TODAY}
                                locale={locale}
                                writable={writable}
                                labels={{ markPaid: d.finance.billPaid, markedPaid: d.finance.billMarkedPaid, failed: d.finance.billFailed }}
                              />
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {!writable && sampleNote && <p className="mt-3 text-[11px] text-amber-900/80">{sampleNote}</p>}
        </Panel>
      </div>
    </div>
  );
}
