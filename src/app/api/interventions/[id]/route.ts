import { NextRequest, NextResponse } from "next/server";
import { withOrg, dbError } from "@/lib/gestion/api";
import { parseEuroInput } from "@/lib/gestion/euros";
import { ownedDocument } from "@/lib/gestion/documents";
import { nextWorkOrderStep, stepAlreadyTaken, ticketAfterStep, visitInstant, WORK_ORDER_ACTIONS, type WorkOrderAction } from "@/lib/gestion/interventions";
import type { TicketStatus, WorkOrderStatus } from "@/lib/types";

/**
 * One step of an intervention, on its work order: handed to an artisan,
 * scheduled, done, invoiced, paid; declined by the artisan; cancelled by
 * the desk. The transition table in `interventions.ts` is the only judge of
 * what is allowed from where the work order stands; the ticket the tenant
 * watches follows it, so the two never disagree. How it follows is
 * `ticketAfterStep`: never backwards, never reopening a request that was
 * resolved or refused (409 `request_closed`: it is reopened on purpose
 * first), never moving the day it was closed.
 *
 * The work order and the ticket are two writes. If the second fails, the
 * same closing step asked again finds the work order already there and
 * brings the ticket along, so a half-applied step heals on a retry.
 */
const str = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().slice(0, max) : "");

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await withOrg("write");
  if (ctx instanceof NextResponse) return ctx;
  const { g, org } = ctx;
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const action = str(body.action, 20) as WorkOrderAction;
  if (!WORK_ORDER_ACTIONS.includes(action)) return NextResponse.json({ error: "invalid" }, { status: 400 });

  const { data: wo, error: readErr } = await g.from("work_orders").select("id,ticket_id,status,artisan_contact_id").eq("org_id", org.id).eq("id", id).maybeSingle();
  if (readErr) return dbError("work order lookup", readErr);
  if (!wo) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const current = String(wo.status) as WorkOrderStatus;
  const step = nextWorkOrderStep(current, action);
  const healing = !step && stepAlreadyTaken(current, action);
  if (!step && !healing) return NextResponse.json({ error: "refused", status: current }, { status: 409 });

  // The ticket as it stands: the step is judged against it before anything is written.
  const { data: ticket, error: ticketReadErr } = await g.from("tickets").select("id,status,source,closed_at").eq("org_id", org.id).eq("id", wo.ticket_id).maybeSingle();
  if (ticketReadErr) return dbError("ticket lookup", ticketReadErr);
  if (!ticket) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const follow = ticketAfterStep(action, { status: String(ticket.status) as TicketStatus, source: String(ticket.source ?? "") });
  if (follow === "request_closed") return NextResponse.json({ error: "request_closed", status: current }, { status: 409 });

  const now = new Date().toISOString();
  const followTicket = async () => {
    const closure = follow.closure === "set" ? { closed_at: ticket.closed_at ?? now } : follow.closure === "clear" ? { closed_at: null } : {};
    return g.from("tickets").update({ status: follow.status, updated_at: now, ...closure }).eq("org_id", org.id).eq("id", wo.ticket_id);
  };
  if (!step) {
    const { error: healErr } = await followTicket();
    if (healErr) return dbError("ticket follow-up", healErr);
    return NextResponse.json({ ok: true, status: current, ticketStatus: follow.status });
  }

  const patch: Record<string, unknown> = { status: step.status };
  if (action === "assign") {
    // The artisan is a contact of the workspace, verified under the same token.
    const artisanId = str(body.artisanContactId, 64);
    if (!artisanId) return NextResponse.json({ error: "invalid" }, { status: 400 });
    const { data: artisan, error: artisanErr } = await g.from("contacts").select("id").eq("org_id", org.id).eq("id", artisanId).maybeSingle();
    if (artisanErr) return dbError("artisan lookup", artisanErr);
    if (!artisan) return NextResponse.json({ error: "invalid" }, { status: 400 });
    patch.artisan_contact_id = artisanId;
  }
  if (action === "schedule") {
    // The day, and the hour on Luxembourg's clock when the desk entered one: no hour is invented for a day alone.
    const at = visitInstant(str(body.scheduledAt, 10), str(body.scheduledTime, 5) || null);
    if (!at) return NextResponse.json({ error: "invalid" }, { status: 400 });
    patch.scheduled_at = at;
  }
  if (action === "invoice") {
    const amount = parseEuroInput(str(body.amount, 20));
    if (amount === null) return NextResponse.json({ error: "invalid" }, { status: 400 });
    const vatRaw = str(body.vat, 20);
    const vat = vatRaw === "" ? 0 : parseEuroInput(vatRaw);
    if (vat === null) return NextResponse.json({ error: "invalid" }, { status: 400 });
    patch.amount_cents = amount;
    patch.vat_cents = vat;
    // The invoice itself, when it was uploaded for this work order.
    const invoiceDocumentId = str(body.invoiceDocumentId, 64);
    if (invoiceDocumentId) {
      const piece = await ownedDocument(ctx, invoiceDocumentId, { type: "work_order", id });
      if (!piece) return NextResponse.json({ error: "invalid" }, { status: 400 });
      patch.invoice_document_id = piece.id;
    }
  }

  const { data, error } = await g.from("work_orders").update(patch).eq("org_id", org.id).eq("id", id).eq("status", current).select("id");
  if (error) return dbError("work order update", error);
  if (!data?.length) return NextResponse.json({ error: "changed" }, { status: 409 });

  const { error: ticketErr } = await followTicket();
  if (ticketErr) return dbError("ticket follow-up", ticketErr);
  return NextResponse.json({ ok: true, status: step.status, ticketStatus: follow.status });
}
