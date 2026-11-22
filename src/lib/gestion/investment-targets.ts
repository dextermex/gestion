import "server-only";
import { NextResponse } from "next/server";
import { dbError, isUuid, type OrgContext } from "@/lib/gestion/api";

/**
 * A loan names the property, and possibly the lot, it finances. Both ids
 * come from the request, so they are read in the active workspace before
 * anything is written: a loan never points at a record of another
 * workspace, and a lot belongs to the property named beside it. Returns the
 * answer to send, or null when the targets are the workspace's own.
 */
export async function refuseForeignLoanTargets(ctx: Pick<OrgContext, "g" | "org">, loan: { propertyId?: string | null; unitId?: string | null }): Promise<NextResponse | null> {
  const propertyId = loan.propertyId || null;
  const unitId = loan.unitId || null;
  const invalid = () => NextResponse.json({ error: "invalid_record", field: unitId && !propertyId ? "unitId" : "propertyId" }, { status: 400 });
  if ((propertyId && !isUuid(propertyId)) || (unitId && !isUuid(unitId))) return invalid();
  if (propertyId) {
    const { data, error } = await ctx.g.from("properties").select("id").eq("org_id", ctx.org.id).eq("id", propertyId).maybeSingle();
    if (error) return dbError("loan property lookup", error);
    if (!data) return invalid();
  }
  if (unitId) {
    const { data, error } = await ctx.g.from("units").select("id,property_id").eq("org_id", ctx.org.id).eq("id", unitId).maybeSingle();
    if (error) return dbError("loan lot lookup", error);
    if (!data || (propertyId && String((data as { property_id?: unknown }).property_id) !== propertyId)) return NextResponse.json({ error: "invalid_record", field: "unitId" }, { status: 400 });
  }
  return null;
}
