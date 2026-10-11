import "server-only";
import type { LoanRecord } from "@/lib/investment/loans";
import type { AcquisitionRecord } from "@/lib/investment/acquisition";
import type { OrgContext } from "@/lib/gestion/api";

export const LOAN_COLUMNS = "id,property_id,unit_id,name,bank_name,original_cents,balance_cents,balance_date,annual_rate_pct,rate_type,remaining_months,insurance_cents,next_payment_date,fixed_until,notes,created_at,updated_at";
export const ACQUISITION_COLUMNS = "id,name,address,stage,asking_price_cents,expected_rent_cents,bank_name,financing_status,notary_name,next_action,next_action_date,viewing_date,compromis_date,finance_deadline,notary_appointment_date,deed_signed_date,transfer_date,handover_date,notes,created_at,updated_at";
const str=(v:unknown)=>typeof v==="string"?v:"";
const nullable=(v:unknown)=>typeof v==="string"&&v? v.slice(0,10):null;
const num=(v:unknown)=>typeof v==="number"?v:Number(v??0);
export function mapLoanRow(r: Record<string,unknown>): LoanRecord { return {id:str(r.id),propertyId:str(r.property_id),unitId:typeof r.unit_id==="string"?r.unit_id:null,name:str(r.name),bankName:str(r.bank_name),originalCents:num(r.original_cents),balanceCents:num(r.balance_cents),balanceDate:str(r.balance_date).slice(0,10),annualRatePct:num(r.annual_rate_pct),rateType:r.rate_type === "variable" ? "variable":"fixed",remainingMonths:num(r.remaining_months),insuranceCents:num(r.insurance_cents),nextPaymentDate:nullable(r.next_payment_date),fixedUntil:nullable(r.fixed_until),notes:str(r.notes),createdAt:str(r.created_at),updatedAt:str(r.updated_at)}; }
export function mapAcquisitionRow(r: Record<string,unknown>): AcquisitionRecord { return {id:str(r.id),name:str(r.name),address:str(r.address),stage:r.stage as AcquisitionRecord["stage"],askingPriceCents:r.asking_price_cents==null?null:num(r.asking_price_cents),expectedRentCents:r.expected_rent_cents==null?null:num(r.expected_rent_cents),bankName:str(r.bank_name),financingStatus:r.financing_status as AcquisitionRecord["financingStatus"],notaryName:str(r.notary_name),nextAction:str(r.next_action),nextActionDate:nullable(r.next_action_date),viewingDate:nullable(r.viewing_date),compromisDate:nullable(r.compromis_date),financeDeadline:nullable(r.finance_deadline),notaryAppointmentDate:nullable(r.notary_appointment_date),deedSignedDate:nullable(r.deed_signed_date),transferDate:nullable(r.transfer_date),handoverDate:nullable(r.handover_date),notes:str(r.notes),createdAt:str(r.created_at),updatedAt:str(r.updated_at)}; }

/**
 * A loan names a property and, optionally, one of its lots. The foreign keys
 * are single-column (`property_id`, `unit_id`), and a foreign key is checked
 * without the policies, so the database alone would accept another
 * workspace's id. Both are read here under the caller's own token, scoped to
 * the active workspace: a lot must also stand in the property named.
 */
export type LoanScopeProblem = "property" | "unit" | "storage";
export async function loanScopeProblem(g: OrgContext["g"], orgId: string, propertyId: string, unitId: string | null): Promise<LoanScopeProblem | null> {
  const { data: property, error } = await g.from("properties").select("id").eq("org_id", orgId).eq("id", propertyId).maybeSingle();
  if (error) return "storage";
  if (!property) return "property";
  if (unitId === null) return null;
  const { data: unit, error: unitError } = await g.from("units").select("id,property_id").eq("org_id", orgId).eq("id", unitId).maybeSingle();
  if (unitError) return "storage";
  if (!unit || String((unit as Record<string, unknown>).property_id) !== propertyId) return "unit";
  return null;
}
