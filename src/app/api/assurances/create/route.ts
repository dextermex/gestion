import { NextRequest, NextResponse } from "next/server";
import { withOrg, dbError } from "@/lib/gestion/api";
import { parseEuroInput } from "@/lib/gestion/euros";

const KINDS = ["building", "pno", "liability", "rent_guarantee", "pi", "other"] as const;

/** Records an insurance policy in the workspace's register. */
export async function POST(req: NextRequest) {
  const ctx = await withOrg();
  if (ctx instanceof NextResponse) return ctx;
  const { g, org } = ctx;

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const kind = (KINDS as readonly string[]).includes(String(body.kind)) ? String(body.kind) : "other";
  const provider = String(body.provider ?? "").trim().slice(0, 120);
  const policyNumber = String(body.policyNumber ?? "").trim().slice(0, 60);
  const premiumRaw = String(body.premium ?? "").trim();
  const premiumCents = premiumRaw === "" ? 0 : parseEuroInput(premiumRaw) ?? -1;
  const propertyId = String(body.propertyId ?? "") || null;
  const expiresOn = /^\d{4}-\d{2}-\d{2}$/.test(String(body.expiresOn)) ? String(body.expiresOn) : null;
  const startsOn = /^\d{4}-\d{2}-\d{2}$/.test(String(body.startsOn)) ? String(body.startsOn) : null;
  if (!provider || premiumCents < 0) return NextResponse.json({ error: "invalid" }, { status: 400 });

  if (propertyId) {
    const { data: property, error } = await g
      .from("properties")
      .select("id")
      .eq("org_id", org.id)
      .eq("id", propertyId)
      .maybeSingle();
    if (error) return dbError("insurance property lookup", error);
    if (!property) return NextResponse.json({ error: "invalid" }, { status: 400 });
  }

  const { data: policy, error } = await g
    .from("insurance_policies")
    .insert({
      org_id: org.id,
      property_id: propertyId,
      kind,
      provider,
      policy_number: policyNumber,
      premium_cents: premiumCents,
      starts_on: startsOn,
      expires_on: expiresOn,
    })
    .select("id")
    .single();
  if (error || !policy) return dbError("insurance insert", error);
  return NextResponse.json({ id: policy.id });
}
