import { NextRequest, NextResponse } from "next/server";
import { withOrg, dbError, isUuid, isoDay, refuseWithout } from "@/lib/gestion/api";
import { parseEuroInput } from "@/lib/gestion/euros";

const KINDS = ["building", "pno", "liability", "rent_guarantee", "pi", "other"] as const;

/** Records an insurance policy in the workspace's register. */
export async function POST(req: NextRequest) {
  const ctx = await withOrg("write");
  if (ctx instanceof NextResponse) return ctx;
  const { g, org } = ctx;
  const refused = await refuseWithout(ctx, "gestion.properties.edit");
  if (refused) return refused;

  const raw = (await req.json().catch(() => null)) as unknown;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return NextResponse.json({ error: "invalid" }, { status: 400 });
  const body = raw as Record<string, unknown>;
  // No kind given is "other"; a kind that is not one is refused, never stored as another.
  const givenKind = String(body.kind ?? "");
  if (givenKind !== "" && !(KINDS as readonly string[]).includes(givenKind)) return NextResponse.json({ error: "invalid" }, { status: 400 });
  const kind = givenKind || "other";
  const provider = String(body.provider ?? "").trim().slice(0, 120);
  const policyNumber = String(body.policyNumber ?? "").trim().slice(0, 60);
  const premiumRaw = String(body.premium ?? "").trim();
  const premiumCents = premiumRaw === "" ? 0 : parseEuroInput(premiumRaw) ?? -1;
  const propertyId = String(body.propertyId ?? "") || null;
  if (propertyId && !isUuid(propertyId)) return NextResponse.json({ error: "invalid" }, { status: 400 });
  const given = (v: unknown) => v !== undefined && v !== null && v !== "";
  const expiresOn = isoDay(body.expiresOn);
  const startsOn = isoDay(body.startsOn);
  // A date that was typed and is not a day is refused, never dropped.
  if ((given(body.expiresOn) && !expiresOn) || (given(body.startsOn) && !startsOn)) return NextResponse.json({ error: "invalid" }, { status: 400 });
  if (startsOn && expiresOn && expiresOn < startsOn) return NextResponse.json({ error: "invalid" }, { status: 400 });
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
