import { NextRequest, NextResponse } from "next/server";
import { withOrg } from "@/lib/gestion/api";
import { connectedProvider } from "@/lib/signature/connect";
import { cancelSending } from "@/lib/signature/service";

/** Cancels a sending still out: at the provider, then here. */
export const runtime = "nodejs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest) {
  const ctx = await withOrg("write");
  if (ctx instanceof NextResponse) return ctx;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const envelopeId = typeof body.envelopeId === "string" ? body.envelopeId.trim() : "";
  if (!UUID.test(envelopeId)) return NextResponse.json({ error: "invalid" }, { status: 400 });
  const result = await cancelSending(ctx, connectedProvider(), envelopeId);
  if ("error" in result) {
    if (result.error === "not_found") return NextResponse.json(result, { status: 404 });
    if (result.error === "not_live") return NextResponse.json(result, { status: 409 });
    if (result.error === "provider") {
      console.error("signature cancel refused by the provider:", result.reason);
      return NextResponse.json(result, { status: 502 });
    }
    return NextResponse.json(result, { status: 503 });
  }
  return NextResponse.json(result);
}
