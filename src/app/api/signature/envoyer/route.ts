import { NextRequest, NextResponse } from "next/server";
import { withOrgAndClient, dbError, jsonBody, refuseWithout } from "@/lib/gestion/api";
import { RATE, refuseOverRate } from "@/lib/gestion/rate-limit";
import { connectedProvider } from "@/lib/signature/connect";
import { isSignatureLevel, type SignerLocale } from "@/lib/signature/envelope";
import { sendLeaseForSignature, type SignerForm } from "@/lib/signature/service";
import { todayISO } from "@/lib/clock";

/**
 * Sends a dossier's contract to be signed: the lease, the tenants' level,
 * each tenant as the dialog confirmed them and the person signing for the
 * lessor. Answers the sending's id, or why not.
 */
export const runtime = "nodejs";
export const maxDuration = 60;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const str = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().slice(0, max) : "");
const locale = (v: unknown): SignerLocale => (v === "en" || v === "de" ? v : "fr");
const signer = (v: unknown): SignerForm | null => {
  if (typeof v !== "object" || v === null) return null;
  const o = v as Record<string, unknown>;
  const contactId = str(o.contactId, 64);
  return {
    contactId: contactId && UUID.test(contactId) ? contactId : null,
    firstName: str(o.firstName, 80),
    lastName: str(o.lastName, 80),
    email: str(o.email, 254),
    phone: str(o.phone, 32) || null,
    locale: locale(o.locale),
  };
};

export async function POST(req: NextRequest) {
  const ctx = await withOrgAndClient("write");
  if (ctx instanceof NextResponse) return ctx;
  const body = await jsonBody(req);
  const leaseId = str(body.leaseId, 64);
  const level = body.level;
  const tenants = Array.isArray(body.tenants) ? body.tenants.slice(0, 10).map(signer) : [];
  const lessor = signer(body.lessor);
  if (!UUID.test(leaseId) || !isSignatureLevel(level) || tenants.length === 0 || tenants.some((t) => !t) || !lessor) {
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }
  // A sending is billed and reaches people by e-mail and SMS: the role is
  // asked first, and the sendings are counted.
  const refused = await refuseWithout(ctx, "gestion.leases.edit");
  if (refused) return refused;
  const limited = await refuseOverRate(ctx.g, RATE.signatureSend, ctx.org.id);
  if (limited) return limited;
  const today = todayISO();
  const result = await sendLeaseForSignature(ctx, ctx.client, connectedProvider(), { leaseId, level, tenants: tenants as SignerForm[], lessor }, today);
  if ("error" in result) {
    switch (result.error) {
      case "not_configured":
      case "schema_outdated":
        return NextResponse.json(result, { status: 503 });
      case "not_found":
        return NextResponse.json(result, { status: 404 });
      case "signers_invalid":
        return NextResponse.json(result, { status: 422 });
      case "provider":
        console.error("signature sending refused by the provider:", result.reason);
        return NextResponse.json(result, { status: 502 });
      case "storage_failed":
        return dbError(result.context, result.detail);
      case "template_error":
        return NextResponse.json(result, { status: 500 });
      default:
        return NextResponse.json(result, { status: 409 });
    }
  }
  return NextResponse.json(result, { status: 201 });
}
