import { NextRequest, NextResponse } from "next/server";
import { withOrg, dbError } from "@/lib/gestion/api";
import { createRental, parseRentalInput } from "@/lib/gestion/rental";
import { getI18n } from "@/lib/i18n";

/**
 * The guided tenancy, as a route: the request is parsed once, the work is
 * done by `createRental`, and the answer names the lease, the people and
 * the property so the wizard can carry on from the same canonical rows the
 * property sheet reads.
 */
export async function POST(req: NextRequest) {
  const ctx = await withOrg();
  if (ctx instanceof NextResponse) return ctx;
  const { d, locale } = await getI18n();
  const today = new Date().toISOString().slice(0, 10);

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const input = parseRentalInput(body, today, locale);
  if (!input) return NextResponse.json({ error: "invalid" }, { status: 400 });

  const result = await createRental(ctx, d, input);
  if ("error" in result) {
    if (result.error === "storage_failed") return dbError(result.context, result.detail);
    return NextResponse.json({ error: result.error }, { status: result.error === "not_found" ? 404 : 409 });
  }

  return NextResponse.json({
    leaseId: result.leaseId,
    contactId: result.contactIds[0],
    contactIds: result.contactIds,
    propertyId: result.propertyId,
    status: result.status,
    issues: result.issues,
    periodsOpened: result.periodsOpened,
  });
}
