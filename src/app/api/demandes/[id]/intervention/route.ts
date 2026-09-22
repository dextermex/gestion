import { NextResponse } from "next/server";
import { withOrg } from "@/lib/gestion/api";
import { createIntervention, statusOfFailure } from "@/lib/gestion/requests";

/**
 * "Créer une intervention" on a tenant request: a work order on the same
 * ticket. The request, its thread and its photos stay as they are; the
 * Interventions screen lists it from now on. Idempotent.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await withOrg();
  if (ctx instanceof NextResponse) return ctx;
  const { id } = await params;

  const result = await createIntervention(ctx, id);
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: statusOfFailure(result.error) });
  return NextResponse.json({ ok: true, id: result.id, created: result.created });
}
