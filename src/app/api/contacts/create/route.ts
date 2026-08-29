import { NextRequest, NextResponse } from "next/server";
import { withOrg, dbError } from "@/lib/gestion/api";

const ROLES = ["tenant", "owner", "guarantor", "artisan", "supplier", "syndic", "lead", "other"] as const;

/** Creates a contact with one dated role, under the caller's JWT. */
export async function POST(req: NextRequest) {
  const ctx = await withOrg();
  if (ctx instanceof NextResponse) return ctx;
  const { g, org } = ctx;

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const name = String(body.name ?? "").trim().slice(0, 120);
  const kind = body.kind === "legal" ? "legal" : "natural";
  const email = String(body.email ?? "").trim().slice(0, 160) || null;
  const phone = String(body.phone ?? "").trim().slice(0, 40) || null;
  const role = (ROLES as readonly string[]).includes(String(body.role)) ? String(body.role) : "tenant";
  if (!name) return NextResponse.json({ error: "invalid" }, { status: 400 });

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
    started_on: new Date().toISOString().slice(0, 10),
  });
  if (roleErr) console.error("contact role insert failed:", roleErr.code, roleErr.message);

  return NextResponse.json({ id: contact.id });
}
