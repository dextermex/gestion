import { Badge, PageHeader, EmptyState } from "@/components/pro/ui";
import { LegalNote, Panel } from "@/components/gestion/bits";
import BillUpload from "@/components/gestion/BillUpload";
import { getDemo } from "@/lib/demo";
import { euros } from "@/lib/types";
import { getI18n } from "@/lib/i18n";
import { fmt } from "@/lib/i18n/config";
import { managementFeeVat } from "@/domain/fiscal/vat";
import { splitExact } from "@/domain/money";

export default async function FinancePage() {
  const { locale, d } = await getI18n();
  const { ORG, RENT_PERIODS, TICKETS, UNITS, contactById, leaseById, leaseUnitLabel, propertyById, unitById } =
    await getDemo();

    // A real account with nothing in it: say so rather than reach for a
    // showcase record that no longer exists.
    if (RENT_PERIODS.length === 0)
      return <EmptyState title={fmt(d.common.emptyTitle, { section: d.nav.finance })} body={d.common.emptyBody} />;

  // Décompte de gérance — juillet 2026, mandat de la SCI (engine-computed).
  const july = RENT_PERIODS.filter((rp) => rp.period === "2026-07");
  const beaulieuLeases = ["l-3b", "l-3c", "l-2a", "l-1a", "l-rdc"];
  const collectedRows = july
    .filter((rp) => beaulieuLeases.includes(rp.leaseId))
    .map((rp) => ({ rp, lease: leaseById(rp.leaseId) }));
  const collected = collectedRows.reduce((a, r) => a + r.rp.allocatedCents, 0);

  const feeNet = Math.round(collected * 0.04);
  const fee = managementFeeVat(feeNet, "2026-07-31");
  const krierInvoice = 124_000; // boiler repair, owner charge
  const netToOwner = collected - fee.gross - krierInvoice;

  // Co-owner split through the SCI (60/40) — exact to the cent.
  const [faberShare, pierreShare] = splitExact(netToOwner, [60, 40]);

  const sci = contactById("c-sci-bealieu");
  const ownerA = contactById("c-faber");
  const ownerB = contactById("c-faber-p");
  const artisan = contactById("c-krier");
  const boilerTicket = TICKETS.find((t) => t.id === "t-1")!;
  const unit3b = unitById("u-b-3b").label;

  return (
    <div>
      <PageHeader
        title={d.finance.title}
        subtitle={d.finance.subtitle}
        actions={
          <BillUpload
            d={d}
            inbox={ORG.billInbox}
            suppliers={[artisan, contactById("c-da-silva"), contactById("c-elektro")].map((c) => ({
              id: c.id,
              name: c.name,
            }))}
            unitOptions={UNITS.map((u) => ({
              id: u.id,
              label: `${u.label} — ${propertyById(u.propertyId).name}`,
            }))}
            ocr={{
              supplierId: artisan.id,
              subject: boilerTicket.title,
              docNo: "2026-0812",
              docDate: "2026-08-08",
              amountLabel: "1 240,00",
              unitId: "u-b-3b",
            }}
          />
        }
      />

      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <Panel title={fmt(d.finance.statementTitle, { sci: sci.name })}>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-sand-100 bg-sand-50/60 text-left text-[11px] uppercase tracking-wide text-ink-soft">
                    <th className="px-3 py-2.5 font-semibold">{d.finance.colEntry}</th>
                    <th className="px-3 py-2.5 text-right font-semibold">{d.finance.colAmount}</th>
                  </tr>
                </thead>
                <tbody>
                  {collectedRows.map(({ rp, lease }) => (
                    <tr key={rp.id} className="border-b border-sand-50">
                      <td className="px-3 py-2.5 text-ink">
                        {fmt(d.finance.rentCollected, { unit: leaseUnitLabel(lease) })}
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
                        {fmt(d.finance.feeDetail, { net: euros(fee.net, locale), vat: euros(fee.vat, locale) })}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-red-700">− {euros(fee.gross, locale)}</td>
                  </tr>
                  <tr className="border-b border-sand-50">
                    <td className="px-3 py-2.5 text-ink">
                      {fmt(d.finance.invoiceLine, { artisan: artisan.name, unit: unit3b })}
                      <span className="ml-2 text-xs text-ink-soft">{d.finance.invoiceDetail}</span>
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-red-700">
                      − {euros(krierInvoice, locale)}
                    </td>
                  </tr>
                  <tr className="bg-sand-50/60">
                    <td className="px-3 py-2.5 font-bold text-ink">{d.finance.netToOwner}</td>
                    <td className="px-3 py-2.5 text-right font-display font-bold tabular-nums text-emerald-700">
                      {euros(netToOwner, locale)}
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
                    <span className="text-ink-soft">{ownerA.name} — 60 %</span>
                    <span className="font-semibold tabular-nums text-ink">{euros(faberShare, locale)}</span>
                  </li>
                  <li className="flex justify-between">
                    <span className="text-ink-soft">{ownerB.name} — 40 %</span>
                    <span className="font-semibold tabular-nums text-ink">{euros(pierreShare, locale)}</span>
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
    </div>
  );
}
