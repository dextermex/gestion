import { NextRequest, NextResponse } from "next/server";
import { withOrgAndClient } from "@/lib/gestion/api";
import { connectedProvider } from "@/lib/signature/connect";
import { syncSendings } from "@/lib/signature/service";

/**
 * Reads the workspace's open sendings back from the provider (or the ones
 * named), each at most once a minute; the signed contracts are sealed in
 * the register as they complete. Answers how many were read and changed.
 */
export const runtime = "nodejs";
export const maxDuration = 60;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest) {
  const ctx = await withOrgAndClient();
  if (ctx instanceof NextResponse) return ctx;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const ids = Array.isArray(body.envelopeIds) ? body.envelopeIds.filter((v): v is string => typeof v === "string" && UUID.test(v)).slice(0, 20) : undefined;
  const result = await syncSendings(ctx, ctx.client, connectedProvider(), { envelopeIds: ids, force: body.force === true });
  if ("error" in result) return NextResponse.json(result, { status: 503 });
  return NextResponse.json(result);
}
