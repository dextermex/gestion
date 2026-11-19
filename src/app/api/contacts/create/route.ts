import { NextRequest, NextResponse } from "next/server";
import { withOrg, dbError, refuseWithout, jsonBody } from "@/lib/gestion/api";
import { todayISO } from "@/lib/clock";

const ROLES = ["tenant", "owner", "guarantor", "artisan", "supplier", "syndic", "lead", "other"] as const;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Creates a contact with one dated role, under the caller's JWT. */
export async function POST(req: NextRequest) {
  const ctx = await withOrg("write");
  if (ctx instanceof NextResponse) return ctx;
  const { g, org } = ctx;
  const refused = await refuseWithout(ctx, "gestion.tenants.edit");
  if (refused) return refused;

  const body = await jsonBody(req);
  const name = String(body.name ?? "").trim().slice(0, 120);
  const kind = body.kind === "legal" ? "legal" : "natural";
  // Lower-cased, like everywhere a contact is written: one spelling per address.
  const email = String(body.email ?? "").trim().slice(0, 160).toLowerCase() || null;
  const phone = String(body.phone ?? "").trim().slice(0, 40) || null;
  const role = (ROLES as readonly string[]).includes(String(body.role)) ? String(body.role) : "tenant";
  if (!name) return NextResponse.json({ error: "invalid" }, { status: 400 });
  // Mail is sent to this address: it is an address or it is empty.
  if (email && !EMAIL.test(email)) return NextResponse.json({ error: "invalid", field: "email" }, { status: 400 });

  // display_name is a generated column (first + last, else legal_name):
  // a natural person's input splits on the last space so the generated
  // display recombines to exactly what was typed.
  const lastSpace = name.lastIndexOf(" ");
  const nameCols =
    kind === "legal"
      ? { legal_name: name }
      : lastSpace > 0
        ? { first_name: name.slice(0, lastSpace), last_name: name.slice(lastSpace + 1) }
        : { first_name: name };
  const { data: contact, error } = await g
    .from("contacts")
    .insert({ org_id: org.id, kind, ...nameCols, email, phone, language: "fr" })
    .select("id")
    .single();
  if (error || !contact) return dbError("contact insert", error);

  const { error: roleErr } = await g.from("contact_roles").insert({
    org_id: org.id,
    contact_id: contact.id,
    role,
    started_on: todayISO(),
  });
  if (roleErr) {
    // A contact without its role appears in no list: it is taken back, and the failure is said.
    const undone = await g.from("contacts").delete().eq("org_id", org.id).eq("id", contact.id);
    if (undone.error) console.error("contact without a role could not be removed:", undone.error.code);
    return dbError("contact role insert", roleErr);
  }

  return NextResponse.json({ id: contact.id });
}
