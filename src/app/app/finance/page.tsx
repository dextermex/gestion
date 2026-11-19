import Link from "next/link";
import { Badge } from "@/components/pro/ui";
import { LegalNote, Panel } from "@/components/gestion/bits";
import BillActions from "@/components/gestion/BillActions";
import BillUpload from "@/components/gestion/BillUpload";
import { FlowBars, PropertyFlows, ShareBars, type FlowBar } from "@/components/gestion/FlowBars";
import QuerySelect from "@/components/gestion/QuerySelect";
import { FoldRow, GroupHead, Hero, HeroAction, HeroChip, MonthSwitch, Money, Row, Rows, Section, Segments } from "@/components/gestion/Hero";
import { getDemo, isSampleData } from "@/lib/demo";
import type { DemoData } from "@/lib/demo";
import { euros, eurosWhole, formatDate, formatMonth } from "@/lib/types";
import type { Locale } from "@/lib/i18n/config";
import { getI18n } from "@/lib/i18n";
import { INTL_LOCALE, fmt } from "@/lib/i18n/config";
import type { Dict } from "@/lib/i18n/fr";
import { billState, type BillCategory } from "@/lib/gestion/bills";
import { managementFeeVat } from "@/domain/fiscal/vat";
import { splitExact } from "@/domain/money";
import { addMonths } from "@/domain/dates";
import { billDay, expensesByCategory, expensesByCategoryIn, flowsByProperty, monthlyFlows, unpaidBills, yearResult } from "@/domain/finance/overview";

/**
 * Finance: what came in, what went out and what is left, month by month,
 * then what is still to pay. Revenus, Charges and Résultat are the same
 * books read three ways. The agency's side (the managed SCI's statement,
 * fees and payout, the accounting exports) sits in Comptabilité, which only
 * a workspace that carries a mandate sees.
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

/** Comptabilité: the mandate's statement, the third-party accounts and the exports, as an agency reads them. */
function Books({ statement, demo, d, locale }: { statement: NonNullable<ReturnType<typeof sampleStatement>>; demo: DemoData; d: Dict; locale: Locale }) {
  return (
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
  );
}

const VIEWS = ["tresorerie", "revenus", "charges", "resultat", "comptabilite"] as const;
type View = (typeof VIEWS)[number];
const PERIODS = ["mois", "3m", "12m", "annee"] as const;
type Period = (typeof PERIODS)[number];

export default async function FinancePage({ searchParams }: { searchParams: Promise<{ vue?: string; mois?: string; periode?: string; bien?: string }> }) {
  const params = await searchParams;
  const { locale, d } = await getI18n();
  const demo = await getDemo();
  const sample = await isSampleData();
  const { BILLS, CONTACTS, LEASES, ORG, PROPERTIES, RENT_PERIODS, TODAY, UNITS, leaseById, leaseTenantNames, leaseUnitLabel, propertyById } = demo;
  const writable = !sample;
  const sampleNote = sample ? fmt(d.shell.sampleBanner, { cabinet: ORG.shortName }) : null;
  const f = d.finance;

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

  // The month, the stretch of months, the property and the view of the books: all four live in the address.
  const liveMonth = TODAY.slice(0, 7);
  const MONTHS = [-5, -4, -3, -2, -1, 0, 1].map((k) => addMonths(`${liveMonth}-01`, k).slice(0, 7));
  const past = MONTHS.filter((m) => m <= liveMonth);
  const month = params.mois && past.includes(params.mois) ? params.mois : liveMonth;
  const period: Period = PERIODS.includes(params.periode as Period) ? (params.periode as Period) : "mois";
  const property = PROPERTIES.find((p) => p.id === params.bien) ?? null;
  const views: View[] = statement ? [...VIEWS] : VIEWS.filter((v) => v !== "comptabilite");
  const view: View = views.includes(params.vue as View) ? (params.vue as View) : "tresorerie";
  const hrefFor = (next: { v?: View; m?: string; p?: Period; bien?: string | null }) => {
    const v = next.v ?? view;
    const p = next.p ?? period;
    const m = next.m ?? month;
    const b = next.bien === undefined ? (property?.id ?? null) : next.bien;
    const q = new URLSearchParams();
    if (v !== "tresorerie") q.set("vue", v);
    if (p !== "mois") q.set("periode", p);
    if (p === "mois" && m !== liveMonth) q.set("mois", m);
    if (b) q.set("bien", b);
    const qs = q.toString();
    return qs ? `/app/finance?${qs}` : "/app/finance";
  };
  const hrefOf = (v: View, m: string) => hrefFor({ v, m });
  const at = past.indexOf(month);
  const year = month.slice(0, 4);
  // The months the figures cover: the one on the screen, or the stretch chosen, ending this month.
  const last = (n: number) => Array.from({ length: n }, (_, i) => addMonths(`${liveMonth}-01`, i - (n - 1)).slice(0, 7));
  const span = period === "mois" ? [month] : period === "3m" ? last(3) : period === "12m" ? last(12) : last(Number(liveMonth.slice(5, 7)));
  const spanLabel = period === "mois" ? formatMonth(month, locale) : period === "3m" ? f.span3 : period === "12m" ? f.span12 : liveMonth.slice(0, 4);

  // The rows of the property on the screen, each period carrying the property its lease belongs to.
  const propertyOfLease = new Map(LEASES.map((l) => [l.id, UNITS.find((u) => u.id === l.unitId)?.propertyId ?? null]));
  const periodsAll = RENT_PERIODS.map((rp) => ({ ...rp, propertyId: propertyOfLease.get(rp.leaseId) ?? null }));
  const periods = property ? periodsAll.filter((rp) => rp.propertyId === property.id) : periodsAll;
  const bills = property ? BILLS.filter((b) => b.propertyId === property.id) : BILLS;

  const flows = monthlyFlows(periods, bills, period === "mois" ? MONTHS : span);
  const flow = monthlyFlows(periods, bills, span).reduce((a, x) => ({ ...a, inCents: a.inCents + x.inCents, outCents: a.outCents + x.outCents, netCents: a.netCents + x.netCents }), { month, inCents: 0, outCents: 0, netCents: 0 });
  const toPay = unpaidBills(bills, TODAY);
  const paidThisMonth = bills.filter((b) => b.paidOn && b.paidOn.slice(0, 7) === month).sort((a, b) => (b.paidOn ?? "").localeCompare(a.paidOn ?? ""));
  const rentsIn = periods.filter((rp) => rp.period === month && rp.allocatedCents > 0).sort((a, b) => b.allocatedCents - a.allocatedCents);
  const byCategory = expensesByCategory(bills, year);
  const breakdown = expensesByCategoryIn(bills, span);
  const byProperty = property ? [] : flowsByProperty(periodsAll, BILLS, span);
  const propertyMax = Math.max(1, ...byProperty.map((r) => Math.max(r.inCents, r.outCents)));
  const result = yearResult(periods, bills, year, month);
  const allBills = [...bills].sort((a, b) => billDay(b).localeCompare(billDay(a)));

  const bars: FlowBar[] = flows.map((x) => ({
    month: x.month,
    label: flows.length > 7 ? new Date(`${x.month}-01T00:00:00`).toLocaleDateString(INTL_LOCALE[locale], { month: "short" }) : formatMonth(x.month, locale).split(" ")[0],
    inCents: x.inCents,
    outCents: x.outCents,
    future: x.month > liveMonth,
    href: x.month > liveMonth ? null : hrefFor({ p: "mois", m: x.month }),
    inLabel: eurosWhole(x.inCents, locale),
    outLabel: eurosWhole(x.outCents, locale),
  }));

  type Bill = (typeof BILLS)[number];
  /** A bill as a row: who and what, where and its state in words, the amount; its details and its one action inside. */
  const billRow = (bill: Bill) => {
    const state = billState(bill, TODAY);
    const words =
      state === "paid" ? fmt(f.billPaidOn, { date: formatDate(bill.paidOn, locale) }) : state === "overdue" ? fmt(f.billLateSince, { date: formatDate(bill.dueOn, locale) }) : bill.dueOn ? fmt(f.billDueOn, { date: formatDate(bill.dueOn, locale) }) : f.billNoDue;
    const income = bill.direction === "income";
    return (
      <FoldRow
        key={bill.id}
        attrs={{ "data-bill": bill.id }}
        icon={income ? "euro" : "documents"}
        tone={state === "overdue" ? "late" : state === "paid" ? "quiet" : "plain"}
        title={bill.supplierName || bill.subject}
        sub={[words, bill.supplierName ? bill.subject : ""].filter(Boolean).join(" · ")}
        right={`${income ? "+" : "−"} ${eurosWhole(bill.amountCents, locale)}`}
        rightTone={income ? "in" : state === "overdue" ? "late" : state === "paid" ? "soft" : "plain"}
      >
        <dl className="grid grid-cols-1 gap-x-8 gap-y-1.5 text-[13px] sm:grid-cols-2">
          {(
            [
              [f.billsColAmount, `${euros(bill.amountCents, locale)}${bill.vatCents > 0 ? ` · ${fmt(f.billVatOf, { vat: euros(bill.vatCents, locale) })}` : ""}`],
              [f.billsColDate, formatDate(billDay(bill), locale)],
              [f.billCategory, categories[bill.category]],
              ...(bill.unitLabel ? [[f.billUnit, bill.unitLabel] as [string, string]] : []),
              ...(bill.docNo ? [[f.billDocNo, bill.docNo] as [string, string]] : []),
            ] as Array<[string, string]>
          ).map(([label, value]) => (
            <div key={label} className="flex items-baseline justify-between gap-3">
              <dt className="text-ink-soft">{label}</dt>
              <dd className="text-right font-medium tabular-nums text-ink">{value}</dd>
            </div>
          ))}
        </dl>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          {state !== "paid" && <BillActions billId={bill.id} todayISO={TODAY} locale={locale} writable={writable} labels={{ markPaid: f.billPaid, markedPaid: f.billMarkedPaid, failed: f.billFailed }} />}
          {bill.hasDocument && bill.documentId && (
            <a href={`/api/documents/${encodeURIComponent(bill.documentId)}/fichier`} className="inline-flex min-h-10 items-center text-sm font-semibold text-brand-700 hover:underline">
              {f.billOpenDoc}
            </a>
          )}
        </div>
      </FoldRow>
    );
  };

  return (
    <div className="space-y-8">
      <Hero
        title={f.title}
        eyebrow={property?.name}
        top={
          period === "mois" ? (
            <MonthSwitch
              label={formatMonth(month, locale)}
              prev={at > 0 ? hrefOf(view, past[at - 1]) : null}
              next={at < past.length - 1 ? hrefOf(view, past[at + 1]) : null}
              prevLabel={d.home.prevMonth}
              nextLabel={d.home.nextMonth}
            />
          ) : undefined
        }
        label={fmt(f.heroLabel, { month: spanLabel })}
        figure={<Money value={eurosWhole(flow.netCents, locale)} />}
        actions={
          <>
            <BillUpload d={d} inbox={ORG.billInbox} suppliers={suppliers} unitOptions={unitOptions} ocr={ocr} writable={writable} sampleNote={sampleNote} trigger="round" triggerLabel={f.actBill} />
            <HeroAction create="payment" icon="plus" label={f.actPayment} />
            <HeroAction href="/app/banque" icon="bank" label={f.actBank} />
          </>
        }
      >
        <HeroChip href={hrefOf("revenus", month)} icon="trending-up">{fmt(f.chipIn, { amount: eurosWhole(flow.inCents, locale) })}</HeroChip>
        <HeroChip href={hrefOf("charges", month)} icon="documents">{fmt(f.chipOut, { amount: eurosWhole(flow.outCents, locale) })}</HeroChip>
      </Hero>

      {/* The views of the books on the left; the stretch of months and the property they are read for on the right. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 max-w-full">
          <Segments
            label={f.tabsAria}
            items={views.map((v) => ({
              href: hrefOf(v, month),
              label: v === "tresorerie" ? f.tabCash : v === "revenus" ? f.tabIncome : v === "charges" ? f.tabCosts : v === "resultat" ? f.tabResult : f.tabBooks,
              count: v === "charges" ? bills.filter((b) => b.direction === "expense").length : undefined,
              current: v === view,
            }))}
          />
        </div>
        {view === "tresorerie" && (
          <div className="flex flex-wrap items-center gap-2">
            <QuerySelect
              label={f.periodAria}
              value={period}
              options={PERIODS.map((p) => ({ value: p, label: p === "mois" ? f.periodMonth : p === "3m" ? f.period3 : p === "12m" ? f.period12 : f.periodYear, href: hrefFor({ p }) }))}
            />
            {PROPERTIES.length > 1 && (
              <QuerySelect
                label={f.propertyAria}
                value={property?.id ?? ""}
                options={[{ value: "", label: f.allProperties, href: hrefFor({ bien: null }) }, ...PROPERTIES.map((p) => ({ value: p.id, label: p.name, href: hrefFor({ bien: p.id }) }))]}
              />
            )}
          </div>
        )}
      </div>

      {view === "tresorerie" && (
        <div className="space-y-9">
          <div className="grid grid-cols-1 gap-9 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:gap-10">
            <Section title={f.chartAria} className="min-w-0">
              <FlowBars bars={bars} selected={period === "mois" ? month : ""} legendIn={f.legendIn} legendOut={f.legendOut} monthHeading={d.dash.cashflowMonth} ariaLabel={f.chartAria} />
            </Section>
            <Section title={f.breakdown} className="min-w-0">
              {breakdown.length === 0 ? (
                <p className="rounded-3xl border border-sand-200/80 bg-white/75 px-5 py-6 text-sm text-ink-soft">{f.breakdownNone}</p>
              ) : (
                <ShareBars rows={breakdown.map((c) => ({ key: c.category, label: categories[c.category as BillCategory] ?? c.category, amount: eurosWhole(c.cents, locale), share: c.share }))} />
              )}
            </Section>
          </div>

          {byProperty.length > 1 && (
            <Section title={f.byProperty}>
              <PropertyFlows
                legendIn={f.legendIn}
                legendOut={f.legendOut}
                rows={byProperty.map((r) => ({
                  key: r.propertyId,
                  label: propertyById(r.propertyId).name,
                  href: hrefFor({ bien: r.propertyId }),
                  net: fmt(f.netOf, { amount: eurosWhole(r.netCents, locale) }),
                  negative: r.netCents < 0,
                  inLabel: eurosWhole(r.inCents, locale),
                  outLabel: eurosWhole(r.outCents, locale),
                  inShare: r.inCents / propertyMax,
                  outShare: r.outCents / propertyMax,
                }))}
              />
            </Section>
          )}

          <div className="grid grid-cols-1 gap-9 lg:grid-cols-2 lg:gap-10">
            <div className="min-w-0">
              <GroupHead title={f.toPay} total={toPay.length > 0 ? eurosWhole(toPay.reduce((a, b) => a + b.amountCents, 0), locale) : undefined} />
              {BILLS.length === 0 ? <p className="px-1 text-sm text-ink-soft">{f.billsNone}</p> : toPay.length === 0 ? <p className="px-1 text-sm text-ink-soft">{f.toPayNone}</p> : <Rows>{toPay.map(billRow)}</Rows>}
            </div>
            {period === "mois" && (
              <div className="min-w-0">
                <GroupHead title={f.movements} />
                {rentsIn.length === 0 && paidThisMonth.length === 0 ? (
                  <p className="px-1 text-sm text-ink-soft">{f.movementsNone}</p>
                ) : (
                  <Rows>
                    {paidThisMonth.map(billRow)}
                    {rentsIn.map((rp) => {
                      const l = leaseById(rp.leaseId);
                      return <Row key={rp.id} href={`/app/baux/${l.id}`} icon="euro" title={leaseTenantNames(l).join(", ") || leaseUnitLabel(l)} sub={leaseUnitLabel(l)} right={`+ ${eurosWhole(rp.allocatedCents, locale)}`} rightTone="in" />;
                    })}
                  </Rows>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {view === "revenus" && (
        <div className="mx-auto max-w-4xl">
          <GroupHead title={f.incomeTitle} total={eurosWhole(rentsIn.reduce((a, rp) => a + rp.allocatedCents, 0), locale)} />
          {rentsIn.length === 0 ? (
            <p className="px-1 text-sm text-ink-soft">{f.incomeNone}</p>
          ) : (
            <Rows>
              {rentsIn.map((rp) => {
                const l = leaseById(rp.leaseId);
                const names = leaseTenantNames(l).join(", ");
                return <Row key={rp.id} href={`/app/baux/${l.id}`} icon="euro" title={names || leaseUnitLabel(l)} sub={leaseUnitLabel(l)} right={`+ ${eurosWhole(rp.allocatedCents, locale)}`} rightTone="in" />;
              })}
            </Rows>
          )}
          {allBills.some((b) => b.direction === "income") && (
            <>
              <GroupHead title={f.otherIncome} />
              <Rows>{allBills.filter((b) => b.direction === "income").map(billRow)}</Rows>
            </>
          )}
        </div>
      )}

      {view === "charges" && (
        <div className="grid grid-cols-1 gap-9 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] lg:gap-10">
          <Section title={fmt(f.costsTitle, { year })} className="min-w-0">
            {byCategory.length === 0 ? (
              <p className="px-1 text-sm text-ink-soft">{f.costsNone}</p>
            ) : (
              <ShareBars rows={byCategory.map((c) => ({ key: c.category, label: categories[c.category as BillCategory] ?? c.category, amount: eurosWhole(c.cents, locale), share: c.share }))} />
            )}
          </Section>
          <Section title={f.billsAll} className="min-w-0">
            {allBills.filter((b) => b.direction === "expense").length === 0 ? <p className="px-1 text-sm text-ink-soft">{f.billsNone}</p> : <Rows>{allBills.filter((b) => b.direction === "expense").map(billRow)}</Rows>}
          </Section>
        </div>
      )}

      {view === "resultat" && (
        <div className="mx-auto max-w-2xl">
          <Section title={fmt(f.resultTitle, { year })}>
            <dl className="overflow-hidden rounded-3xl border border-sand-200/80 bg-white/75">
              {(
                [
                  [f.resultRents, euros(result.rentCents, locale), "text-ink"],
                  [f.resultOther, euros(result.otherIncomeCents, locale), "text-ink"],
                  [f.resultCosts, `− ${euros(result.expenseCents, locale)}`, "text-ink"],
                ] as Array<[string, string, string]>
              ).map(([label, value, cls]) => (
                <div key={label} className="flex items-baseline justify-between gap-3 border-b border-sand-200/80 px-5 py-3.5 text-sm">
                  <dt className="text-ink-soft">{label}</dt>
                  <dd className={`tabular-nums ${cls}`}>{value}</dd>
                </div>
              ))}
              <div className="flex items-baseline justify-between gap-3 bg-brand-50/50 px-5 py-4">
                <dt className="text-sm font-bold text-ink">{f.resultNet}</dt>
                <dd className={"font-display text-xl font-bold tabular-nums " + (result.resultCents >= 0 ? "text-emerald-700" : "text-red-700")}>{euros(result.resultCents, locale)}</dd>
              </div>
            </dl>
            <p className="mt-3 px-1 text-sm">
              <Link href="/app/fiscalite" className="font-semibold text-brand-700 hover:underline">{d.hubs.reports}</Link>
            </p>
          </Section>
        </div>
      )}

      {view === "comptabilite" && statement && <Books statement={statement} demo={demo} d={d} locale={locale} />}
    </div>
  );
}
