import { NextRequest, NextResponse } from "next/server";
import { withOrg, dbError } from "@/lib/gestion/api";
import { LESSOR_IDENTITY_COLUMNS, parseSettingsInput } from "@/lib/documents/settings-rules";

/**
 * The lessor's identity and payment instructions: one row per workspace,
 * written by whoever may edit the settings, read by every document the
 * workspace produces and, for the account to pay into, by its tenants.
 */
export async function PATCH(req: NextRequest) {
  const ctx = await withOrg("write");
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
  // The lessor as a lease contract names them: columns of migration 0028.
  const identity = {
    lessor_kind: parsed.lessorKind,
    lessor_civility: parsed.lessorCivility,
    lessor_birth_date: parsed.lessorBirthDate || null,
    lessor_birth_place: parsed.lessorBirthPlace,
    lessor_nationality: parsed.lessorNationality,
    lessor_legal_form: parsed.lessorLegalForm,
    lessor_rcs_number: parsed.lessorRcsNumber,
    signatory_role: parsed.signatoryRole,
  };
  const { data: existing, error: readErr } = await g.from("workspace_settings").select("org_id").eq("org_id", org.id).maybeSingle();
  if (readErr) return dbError("settings read", readErr);
  const write = async (values: Record<string, unknown>) => {
    if (existing) {
      const { data, error } = await g.from("workspace_settings").update(values).eq("org_id", org.id).select("org_id");
      return { error, missing: !error && !data?.length };
    }
    const { error } = await g.from("workspace_settings").insert({ org_id: org.id, ...values });
    return { error, missing: false };
  };
  let saved = await write({ ...row, ...identity });
  // A base without migration 0028 keeps everything else: the identity waits, and the answer says so.
  let identityPending = false;
  if (saved.error && (saved.error.code === "PGRST204" || saved.error.code === "42703") && LESSOR_IDENTITY_COLUMNS.some((c) => (saved.error?.message ?? "").includes(c))) {
    identityPending = true;
    saved = await write(row);
  }
  if (saved.error) return dbError(existing ? "settings update" : "settings insert", saved.error);
  if (saved.missing) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json(identityPending ? { ok: true, identity: "pending" } : { ok: true });
}
