import { NextRequest, NextResponse } from "next/server";
import { withOrg, dbError } from "@/lib/gestion/api";
import { parseSettingsInput } from "@/lib/documents/settings-rules";

/**
 * The lessor's identity and payment instructions: one row per workspace,
 * written by whoever may edit the settings, read by every document the
 * workspace produces and, for the account to pay into, by its tenants.
 */
export async function PATCH(req: NextRequest) {
  const ctx = await withOrg();
  if (ctx instanceof NextResponse) return ctx;
  const { g, org, userId } = ctx;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const parsed = parseSettingsInput(body);
  if ("problem" in parsed) return NextResponse.json({ error: "invalid", problem: parsed.problem }, { status: 400 });
  const row = {
    legal_name: parsed.legalName,
    signatory_name: parsed.signatoryName,
    address_street: parsed.addressStreet,
    address_number: parsed.addressNumber,
    postal_code: parsed.postalCode,
    city: parsed.city,
    country: parsed.country,
    email: parsed.email,
    phone: parsed.phone,
    iban: parsed.iban,
    bic: parsed.bic,
    holder_name: parsed.holderName,
    document_lang: parsed.documentLang,
    notify_tenant_messages: parsed.notifyTenantMessages,
    notify_manager_messages: parsed.notifyManagerMessages,
    updated_at: new Date().toISOString(),
    updated_by: userId,
  };
  const { data: existing, error: readErr } = await g.from("workspace_settings").select("org_id").eq("org_id", org.id).maybeSingle();
  if (readErr) return dbError("settings read", readErr);
  if (existing) {
    const { data, error } = await g.from("workspace_settings").update(row).eq("org_id", org.id).select("org_id");
    if (error) return dbError("settings update", error);
    if (!data?.length) return NextResponse.json({ error: "not_found" }, { status: 404 });
  } else {
    const { error } = await g.from("workspace_settings").insert({ org_id: org.id, ...row });
    if (error) return dbError("settings insert", error);
  }
  return NextResponse.json({ ok: true });
}
