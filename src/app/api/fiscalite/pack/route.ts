import { NextRequest, NextResponse } from "next/server";
import { withOrg } from "@/lib/gestion/api";
import { getDemo, isSampleData } from "@/lib/demo";
import { getI18n } from "@/lib/i18n";
import { fmt } from "@/lib/i18n/config";
import { renderLabels } from "@/lib/documents/generate";
import { renderPdf } from "@/lib/documents/render";
import { csvDocument, csvEuros, safeFileName } from "@/lib/fiscal/csv";
import { composeFiscalPack } from "@/lib/fiscal/pack-pdf";
import { prepareOwnerYear } from "@/lib/fiscal/pack";
import { lineLabel, sectionLabel } from "@/lib/fiscal/labels";
import { answerNavigation } from "@/lib/http/navigation";

/**
 * The exercise as files: the pack (PDF), the lines of the 190/210
 * statements (CSV, the accountant's import) and one property's form
 * fields (CSV, to copy over). Every figure comes from the same prepared
 * exercise as the screen. A download is a read, for a signed-in member of
 * a workspace: a sample cabinet gets real files computed from its dataset,
 * a real account reads under its own token.
 */
export const runtime = "nodejs";

const str = (v: string | null, max: number): string => (v ?? "").trim().slice(0, max);

function attachment(name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

/** The downloads are plain links: a person whose link has nothing to give is sent to a screen that says so, a script keeps the JSON error. */
export async function GET(req: NextRequest) {
  return answerNavigation(req, await pack(req));
}

async function pack(req: NextRequest): Promise<Response> {
  // A session and a workspace, whatever the dataset: a sample cabinet's files
  // are fictitious, but producing one is work this server does on demand,
  // and it does none for a stranger.
  const ctx = await withOrg();
  if (ctx instanceof NextResponse) return ctx;
  const params = req.nextUrl.searchParams;
  const ownerId = str(params.get("proprietaire"), 64);
  const taxYear = Number(params.get("exercice"));
  const format = str(params.get("format"), 8);
  const propertyId = str(params.get("bien"), 64);
  if (!ownerId || !Number.isInteger(taxYear) || (format !== "pdf" && format !== "csv")) return NextResponse.json({ error: "invalid" }, { status: 400 });

  const [data, { locale, d }, sample] = await Promise.all([getDemo(), getI18n(), isSampleData()]);
  const owner = prepareOwnerYear(data, ownerId, taxYear);
  if (!owner) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const year = owner.year.taxYear;

  if (format === "pdf") {
    const model = composeFiscalPack(owner, { d, locale, cabinetName: data.ORG.name, today: data.TODAY, sample });
    let bytes: Awaited<ReturnType<typeof renderPdf>>;
    try {
      bytes = await renderPdf(model, renderLabels(locale));
    } catch (e) {
      // The renderer's own failure, said as one: the kind of error, never the exercise's figures.
      console.error("fiscal pack render failed:", e instanceof Error ? e.name : "error");
      return NextResponse.json({ error: "render_failed" }, { status: 500 });
    }
    const name = `${safeFileName(fmt(d.fiscalite.dlPack, { year, owner: owner.ownerName }))}.pdf`;
    return new NextResponse(new Uint8Array(bytes), { status: 200, headers: { "Content-Type": "application/pdf", "Content-Disposition": attachment(name), "Cache-Control": "private, no-store" } });
  }

  // One property's form, field by field.
  if (propertyId) {
    const st = owner.statements.find((s) => s.propertyId === propertyId);
    if (!st) return NextResponse.json({ error: "not_found" }, { status: 404 });
    const { pack, property } = st;
    const rows: Array<[string, string | number]> = [
      [d.fiscalite.csvYear, year],
      [d.fiscalite.csvOwner, owner.ownerName],
      [d.fiscalite.csvProperty, property.name],
      [d.fiscalite.csvCadastral, property.cadastralRef],
      [d.fiscalite.csvMonthsLet, pack.monthsLet],
      [d.fiscalite.csvVacancy, pack.vacancyMonths],
      [d.fiscalite.rentDwelling, csvEuros(pack.grossRents.dwelling)],
      [d.fiscalite.rentGarage, csvEuros(pack.grossRents.garageParking)],
      [d.fiscalite.rentFurniture, csvEuros(pack.grossRents.furnitureSupplement)],
      [d.fiscalite.rentRetained, csvEuros(pack.grossRents.retainedDeposits)],
      [d.fiscalite.grossRents, csvEuros(pack.grossRents.totalTaxable)],
      ...pack.sections.map((s): [string, string] => [sectionLabel(d, s.code), csvEuros(s.amount)]),
      [d.fiscalite.totalDeductions, csvEuros(pack.deductionsTotal)],
      [d.fiscalite.socialExemption, csvEuros(pack.socialExemptionApplied)],
      [d.fiscalite.netResult, csvEuros(pack.netResult)],
      [fmt(d.fiscalite.ownerShare, { pct: Math.round((pack.ownerShareNet / (pack.netResult || 1)) * 100) }), csvEuros(pack.ownerShareNet)],
    ];
    const body = csvDocument([[d.fiscalite.csvField, d.fiscalite.csvValue], ...rows]);
    const name = `${safeFileName(fmt(d.fiscalite.dlForm, { year, property: property.name }))}.csv`;
    return new NextResponse(body, { status: 200, headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": attachment(name), "Cache-Control": "private, no-store" } });
  }

  // Every line of every statement: the accountant's import.
  const head = [d.fiscalite.csvYear, d.fiscalite.csvOwner, d.fiscalite.csvProperty, d.fiscalite.csvCadastral, d.fiscalite.csvSection, d.fiscalite.csvLine, d.fiscalite.csvCents, d.fiscalite.csvEuros];
  const rows: Array<Array<string | number>> = [];
  for (const { pack, property } of owner.statements) {
    const base = [year, owner.ownerName, property.name, property.cadastralRef];
    const push = (section: string, line: string, cents: number) => rows.push([...base, section, line, cents, csvEuros(cents)]);
    push(d.fiscalite.grossRents, d.fiscalite.rentDwelling, pack.grossRents.dwelling);
    if (pack.grossRents.garageParking > 0) push(d.fiscalite.grossRents, d.fiscalite.rentGarage, pack.grossRents.garageParking);
    if (pack.grossRents.furnitureSupplement > 0) push(d.fiscalite.grossRents, d.fiscalite.rentFurniture, pack.grossRents.furnitureSupplement);
    if (pack.grossRents.retainedDeposits > 0) push(d.fiscalite.grossRents, d.fiscalite.rentRetained, pack.grossRents.retainedDeposits);
    for (const s of pack.sections) {
      if (s.lines.length === 0 && s.amount === 0) continue;
      if (s.lines.length === 0) push(sectionLabel(d, s.code), sectionLabel(d, s.code), s.amount);
      for (const l of s.lines) if (l.amount > 0) push(sectionLabel(d, s.code), lineLabel(d, l), l.amount);
    }
    push(d.fiscalite.totalDeductions, d.fiscalite.totalDeductions, pack.deductionsTotal);
    if (pack.socialExemptionApplied > 0) push(d.fiscalite.socialExemption, d.fiscalite.socialExemption, -pack.socialExemptionApplied);
    push(d.fiscalite.netResult, d.fiscalite.netResult, pack.netResult);
    push(d.fiscalite.netResult, fmt(d.fiscalite.ownerShare, { pct: Math.round((pack.ownerShareNet / (pack.netResult || 1)) * 100) }), pack.ownerShareNet);
  }
  const body = csvDocument([head, ...rows]);
  const name = `${safeFileName(fmt(d.fiscalite.dlLines, { year, owner: owner.ownerName }))}.csv`;
  return new NextResponse(body, { status: 200, headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": attachment(name), "Cache-Control": "private, no-store" } });
}
