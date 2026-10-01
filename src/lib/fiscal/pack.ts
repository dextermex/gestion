import { planTaxpayerYear, type TaxpayerAmortisationPlan, type YearAmortisation } from "@/domain/fiscal/amortisation";
import { attachmentsFor, buildTaxPack, ownerYearSummary, type Attachment, type OwnerYearSummary, type TaxPack } from "@/domain/fiscal/taxpack";
import type { DemoData } from "@/lib/demo";
import type { DemoFiscalYear, DemoProperty } from "@/lib/demo/data";

/**
 * One owner's exercise, prepared once for the screen, the PDF pack and the
 * CSV files: the statement of every property let (the modèle 190/210
 * pack from the engine), the taxpayer's amortisation plan, the summary
 * the screen leads with, and the pieces to attach with what the vault
 * already holds. Everything is computed through the engines over the
 * active dataset; nothing here is a figure of its own.
 */
export type AttachmentState = "vault" | "cabinet" | "ask";

export interface FiscalAttachment extends Attachment {
  propertyId: string;
  propertyName: string;
  state: AttachmentState;
  /** The piece of the register that answers it, when one does. */
  documentName: string | null;
}

export interface FiscalStatement {
  propertyId: string;
  property: DemoProperty;
  pack: TaxPack;
  amortisation: YearAmortisation | null;
  attachments: FiscalAttachment[];
}

export interface FiscalOwnerYear {
  ownerId: string;
  ownerName: string;
  year: DemoFiscalYear;
  plan: TaxpayerAmortisationPlan;
  statements: FiscalStatement[];
  summary: OwnerYearSummary;
  attachments: FiscalAttachment[];
  /** Pieces still to ask the owner for. */
  missing: number;
  /** The exercise is the running year: its figures are provisional. */
  running: boolean;
}

export interface FiscalOwner {
  id: string;
  name: string;
}

/** The owners the dataset holds fiscal years for, in the dataset's order. */
export function fiscalOwners(data: DemoData): FiscalOwner[] {
  const seen = new Set<string>();
  const out: FiscalOwner[] = [];
  for (const y of data.FISCAL_YEARS) {
    if (seen.has(y.ownerContactId)) continue;
    seen.add(y.ownerContactId);
    out.push({ id: y.ownerContactId, name: data.contactById(y.ownerContactId)?.name ?? y.ownerContactId });
  }
  return out;
}

/** The exercises an owner has, most recent first. */
export function fiscalYears(data: DemoData, ownerId: string): number[] {
  return [...new Set(data.FISCAL_YEARS.filter((y) => y.ownerContactId === ownerId).map((y) => y.taxYear))].sort((a, b) => b - a);
}

/** The exercise that leads: the last closed year when there is one, else the most recent. */
export function defaultFiscalYear(years: number[], today: string): number | null {
  const current = Number(today.slice(0, 4));
  return years.find((y) => y < current) ?? years[0] ?? null;
}

/** Classes whose piece belongs to one exercise: the piece must name the year, or arrive in it or the next. */
const YEAR_BOUND = new Set(["tax", "invoice", "insurance"]);

function vaultState(data: DemoData, taxYear: number, property: DemoProperty, ownerName: string, a: Attachment): { state: AttachmentState; documentName: string | null } {
  if (a.providedBy === "cabinet") return { state: "cabinet", documentName: null };
  if (!a.documentClass) return { state: "ask", documentName: null };
  const names = new Set([property.name, ownerName, ...property.ownerContactIds.map((id) => data.contactById(id)?.name ?? "")]);
  const match = data.DOCUMENTS.find((doc) => {
    if (doc.klass !== a.documentClass || !names.has(doc.relatedLabel)) return false;
    if (!YEAR_BOUND.has(a.documentClass ?? "")) return true;
    return doc.name.includes(String(taxYear)) || doc.createdAt.startsWith(String(taxYear)) || doc.createdAt.startsWith(String(taxYear + 1));
  });
  return match ? { state: "vault", documentName: match.name } : { state: "ask", documentName: null };
}

export function prepareOwnerYear(data: DemoData, ownerId: string, taxYear: number): FiscalOwnerYear | null {
  const year = data.FISCAL_YEARS.find((y) => y.ownerContactId === ownerId && y.taxYear === taxYear);
  const portfolio = data.TAXPAYER_PORTFOLIOS[ownerId];
  if (!year || !portfolio) return null;
  const ownerName = data.contactById(ownerId)?.name ?? ownerId;
  const plan = planTaxpayerYear(portfolio, taxYear, { jointlyTaxed: year.jointlyTaxed });
  const statements: FiscalStatement[] = year.statements.map((st) => {
    const property = data.propertyById(st.propertyId);
    const amortisation = plan.rows.find((r) => r.propertyId === st.propertyId)?.result ?? null;
    const pack = buildTaxPack({
      taxYear,
      propertyLabel: property.name,
      cadastralRef: property.cadastralRef,
      buildingCompletedOn: property.completionDate,
      monthsLet: st.monthsLet,
      vacancyMonths: st.vacancyMonths,
      receipts: st.receipts,
      expenses: st.expenses,
      electedSpreadYears: st.electedSpreadYears,
      priorSpreads: st.priorSpreads,
      amortisation,
      ownerShare: st.ownerShare,
      ownerResidency: year.residency,
      socialRentalManagement: st.socialRentalManagement,
    });
    const attachments = attachmentsFor(pack, amortisation).map((a) => ({
      ...a,
      propertyId: st.propertyId,
      propertyName: property.name,
      ...vaultState(data, taxYear, property, ownerName, a),
    }));
    return { propertyId: st.propertyId, property, pack, amortisation, attachments };
  });
  const attachments = statements.flatMap((s) => s.attachments);
  return {
    ownerId,
    ownerName,
    year,
    plan,
    statements,
    summary: ownerYearSummary(statements.map((s) => s.pack)),
    attachments,
    missing: attachments.filter((a) => a.state === "ask").length,
    running: taxYear >= Number(data.TODAY.slice(0, 4)),
  };
}

export interface FiscalSelection {
  owners: FiscalOwner[];
  ownerId: string | null;
  years: number[];
  taxYear: number | null;
  current: FiscalOwnerYear | null;
  /** Every owner for the selected exercise, the cabinet's overview. */
  all: FiscalOwnerYear[];
}

/** What the screen shows for an address: the owner and exercise asked for, or the defaults. */
export function selectFiscal(data: DemoData, asked: { ownerId?: string; taxYear?: number }): FiscalSelection {
  const owners = fiscalOwners(data);
  const ownerId = owners.some((o) => o.id === asked.ownerId) ? (asked.ownerId as string) : (owners[0]?.id ?? null);
  const years = ownerId ? fiscalYears(data, ownerId) : [];
  const taxYear = asked.taxYear && years.includes(asked.taxYear) ? asked.taxYear : defaultFiscalYear(years, data.TODAY);
  const current = ownerId && taxYear ? prepareOwnerYear(data, ownerId, taxYear) : null;
  const all = taxYear ? owners.map((o) => prepareOwnerYear(data, o.id, taxYear)).filter((x): x is FiscalOwnerYear => x !== null) : [];
  return { owners, ownerId, years, taxYear, current, all };
}
