"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button, Field, Input, Modal, Select } from "@/components/pro/ui";
import { allowedWorkOrderActions, visitHour, type WorkOrderAction } from "@/lib/gestion/interventions";
import { dayKey } from "@/lib/portal/format";
import type { Locale } from "@/lib/i18n/config";
import { euros, formatDate, type Meta, type WorkOrderStatus } from "@/lib/types";
import { uploadPiece } from "@/lib/gestion/upload-client";
import { callJson } from "./call";

/**
 * One intervention, opened from its row: the ticket and the work order
 * behind it, the artisan, the date, the amounts, and the steps the ladder
 * allows from where it stands. Each step is written on the work order and
 * the ticket follows; the page re-reads both. A request that has no work
 * order yet gets one here (the same doorway Messages uses).
 *
 * A request that was resolved or refused (here or in Messages) takes no
 * more hand-over or planning: the sheet says so and offers to reopen it,
 * which is the only way it opens again. A visit is planned for a day, and
 * for an hour only when one is entered.
 *
 * Beside the steps, the desk's follow-up on the request itself: set aside
 * while the tenant is waited on (and taken up again), and the day it is to
 * be handled by. Both are the ticket's, so the counters and the lists that
 * read them follow.
 */
export interface InterventionLabels {
  open: string;
  sheetTitle: string;
  artisan: string;
  artisanNone: string;
  artisanNoneYet: string;
  scheduledOn: string;
  amount: string;
  vat: string;
  workOrderStatus: string;
  noWorkOrder: string;
  createOrder: string;
  actAssign: string;
  actSchedule: string;
  actDone: string;
  actInvoice: string;
  actPaid: string;
  actDecline: string;
  actCancel: string;
  done: string;
  failed: string;
  refused: string;
  requestClosed: string;
  reopen: string;
  scheduledTime: string;
  close: string;
  colStatus: string;
  invoiceFile: string;
  invoiceAttached: string;
  invoiceBadFile: string;
  dueOnLabel: string;
  dueSave: string;
  waitTenant: string;
  resumeWork: string;
  waitingNote: string;
}

export interface SheetTicket {
  id: string;
  ref: string;
  title: string;
  unitLabel: string;
  /** The request was resolved or refused: no step that would take it up again is offered until it is reopened. */
  closed: boolean;
  workOrder: { id: string; status: WorkOrderStatus; artisanContactId: string | null; scheduledAt: string | null; amountCents: number | null; vatCents: number | null } | null;
  /** Set aside while the tenant is waited on. */
  waiting?: boolean;
  /** The day it is to be handled by, "YYYY-MM-DD", when the desk set one. */
  dueOn?: string | null;
}

const BACK = "/app/interventions";
const ORDER: WorkOrderAction[] = ["assign", "schedule", "done", "invoice", "paid", "decline", "cancel"];
/** The steps that take a request up again: not offered on one that is closed. */
const RESUMING: readonly WorkOrderAction[] = ["assign", "schedule", "decline"];
const ACCEPT = "application/pdf,image/jpeg,image/png,image/webp,image/avif";

export default function InterventionSheet({
  ticket,
  ticketMeta,
  workOrderMeta,
  artisans,
  todayISO,
  locale,
  writable,
  sampleNote,
  labels,
}: {
  ticket: SheetTicket;
  ticketMeta: Meta;
  workOrderMeta: Meta | null;
  artisans: Array<{ id: string; name: string }>;
  todayISO: string;
  locale: Locale;
  writable: boolean;
  sampleNote: string | null;
  labels: InterventionLabels;
}) {
  const router = useRouter();
  const wo = ticket.workOrder;
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [artisan, setArtisan] = useState(wo?.artisanContactId ?? "");
  const [scheduledAt, setScheduledAt] = useState(wo?.scheduledAt ? dayKey(wo.scheduledAt) : todayISO);
  const [scheduledTime, setScheduledTime] = useState(wo?.scheduledAt ? visitHour(wo.scheduledAt) : "");
  const [amount, setAmount] = useState(wo?.amountCents != null ? (wo.amountCents / 100).toFixed(2).replace(".", ",") : "");
  const [vat, setVat] = useState(wo?.vatCents != null ? (wo.vatCents / 100).toFixed(2).replace(".", ",") : "");
  const [invoiceFile, setInvoiceFile] = useState<File | null>(null);
  const [dueOn, setDueOn] = useState(ticket.dueOn ?? "");

  const run = async (url: string, method: string, body: Record<string, unknown> | undefined) => {
    setNote(null);
    if (!writable) {
      setNote(labels.done);
      return;
    }
    setBusy(true);
    setError(null);
    // The invoice's piece, stored for this work order before the step that records it.
    let storedPiece: string | null = null;
    try {
      if (body?.action === "invoice" && invoiceFile && wo) {
        // In the request when it can carry the file, straight to the bucket otherwise.
        const stored = await uploadPiece(invoiceFile, { class: "invoice", name: invoiceFile.name, relatedType: "work_order", relatedId: wo.id }, BACK);
        if (!stored) return;
        if (!stored.ok) {
          setError(stored.status === 415 ? labels.invoiceBadFile : labels.failed);
          setBusy(false);
          return;
        }
        storedPiece = String(stored.payload.id);
        body = { ...body, invoiceDocumentId: stored.payload.id };
      }
      const res = await callJson(url, method, body, BACK);
      if (!res) return;
      if (res.ok) {
        setNote(labels.done);
        router.refresh();
      } else {
        // The step was refused: the piece filed for it goes too, rather than staying with nothing that names it.
        if (storedPiece) await fetch(`/api/documents/${encodeURIComponent(storedPiece)}`, { method: "DELETE" }).catch(() => null);
        setError(res.status === 409 ? (res.payload.error === "request_closed" ? labels.requestClosed : labels.refused) : labels.failed);
      }
    } catch {
      setError(labels.failed);
    }
    setBusy(false);
  };

  const actionLabel: Record<WorkOrderAction, string> = {
    assign: labels.actAssign,
    schedule: labels.actSchedule,
    done: labels.actDone,
    invoice: labels.actInvoice,
    paid: labels.actPaid,
    decline: labels.actDecline,
    cancel: labels.actCancel,
  };
  const allowed = wo ? allowedWorkOrderActions(wo.status).filter((a) => !ticket.closed || !RESUMING.includes(a)) : [];
  // Closed while its work order could still move: the way back in is the explicit reopening.
  const reopenable = ticket.closed && wo !== null && allowedWorkOrderActions(wo.status).some((a) => RESUMING.includes(a));
  const disabledFor = (a: WorkOrderAction) => (a === "assign" ? !artisan : a === "schedule" ? !scheduledAt : a === "invoice" ? !amount.trim() : false);
  const bodyFor = (a: WorkOrderAction): Record<string, unknown> =>
    a === "assign" ? { action: a, artisanContactId: artisan } : a === "schedule" ? { action: a, scheduledAt, scheduledTime } : a === "invoice" ? { action: a, amount: amount.trim(), vat: vat.trim() } : { action: a };

  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)} data-intervention-open={ticket.id}>
        {labels.open}
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title={labels.sheetTitle} closeLabel={labels.close} wide>
        <p className="font-semibold text-ink">{ticket.title}</p>
        <p className="text-xs text-ink-soft">
          {ticket.ref} · {ticket.unitLabel || "—"}
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-ink-soft">
          <span>{labels.colStatus}</span>
          <Badge className={ticketMeta.color}>{ticketMeta.label}</Badge>
          <span className="ml-2">{labels.workOrderStatus}</span>
          {workOrderMeta ? <Badge className={workOrderMeta.color}>{workOrderMeta.label}</Badge> : <span>{labels.noWorkOrder}</span>}
        </div>

        {/* The desk's follow-up on the request: waiting on the tenant, and the day it is to be handled by. */}
        <div className="mt-4 grid grid-cols-1 items-end gap-3 sm:grid-cols-2" data-request-follow-up>
          <Field label={labels.dueOnLabel}>
            <Input type="date" value={dueOn} onChange={(e) => setDueOn(e.target.value)} disabled={busy} />
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" loading={busy} disabled={dueOn === (ticket.dueOn ?? "")} onClick={() => run(`/api/demandes/${encodeURIComponent(ticket.id)}`, "PATCH", { dueOn: dueOn || null })}>
              {labels.dueSave}
            </Button>
            {!ticket.closed && (
              <Button size="sm" variant="secondary" loading={busy} onClick={() => run(`/api/demandes/${encodeURIComponent(ticket.id)}`, "PATCH", { waiting: !ticket.waiting })} data-request-waiting={ticket.waiting ? "yes" : "no"}>
                {ticket.waiting ? labels.resumeWork : labels.waitTenant}
              </Button>
            )}
          </div>
          {ticket.waiting && <p className="text-xs leading-relaxed text-ink-soft sm:col-span-2">{labels.waitingNote}</p>}
        </div>

        {wo ? (
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label={labels.artisan}>
              <Select value={artisan} onChange={(e) => setArtisan(e.target.value)} disabled={busy}>
                <option value="">{labels.artisanNone}</option>
                {artisans.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={labels.scheduledOn}>
              <Input type="date" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} disabled={busy} />
            </Field>
            <Field label={labels.scheduledTime}>
              <Input type="time" value={scheduledTime} onChange={(e) => setScheduledTime(e.target.value)} disabled={busy} />
            </Field>
            <Field label={labels.amount}>
              <Input value={amount} inputMode="decimal" placeholder="0,00" onChange={(e) => setAmount(e.target.value)} disabled={busy} />
            </Field>
            <Field label={labels.vat}>
              <Input value={vat} inputMode="decimal" placeholder="0,00" onChange={(e) => setVat(e.target.value)} disabled={busy} />
            </Field>
            {allowed.includes("invoice") && (
              <div className="sm:col-span-2">
                <Field label={labels.invoiceFile}>
                  <input
                    id="invoice-file"
                    type="file"
                    accept={ACCEPT}
                    className="block w-full text-sm text-ink file:mr-3 file:rounded-lg file:border file:border-sand-200 file:bg-white file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-ink-soft"
                    onChange={(e) => setInvoiceFile(e.target.files?.[0] ?? null)}
                    disabled={busy}
                  />
                </Field>
                {invoiceFile && <p className="mt-1 text-xs text-ink-soft">{labels.invoiceAttached.replace("{name}", invoiceFile.name)}</p>}
              </div>
            )}
            {artisans.length === 0 && <p className="text-xs text-ink-soft sm:col-span-2">{labels.artisanNoneYet}</p>}
            {(wo.scheduledAt || wo.amountCents != null) && (
              <p className="text-xs text-ink-soft sm:col-span-2">
                {wo.scheduledAt ? `${labels.scheduledOn} ${formatDate(dayKey(wo.scheduledAt), locale)}${visitHour(wo.scheduledAt) ? ` · ${visitHour(wo.scheduledAt)}` : ""}` : ""}
                {wo.scheduledAt && wo.amountCents != null ? " · " : ""}
                {wo.amountCents != null ? `${labels.amount} ${euros(wo.amountCents, locale)}` : ""}
              </p>
            )}
          </div>
        ) : (
          <div className="mt-4">
            <Button size="sm" loading={busy} onClick={() => run(`/api/demandes/${encodeURIComponent(ticket.id)}/intervention`, "POST", undefined)}>
              {labels.createOrder}
            </Button>
          </div>
        )}

        {wo && allowed.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2">
            {ORDER.filter((a) => allowed.includes(a)).map((a) => (
              <Button
                key={a}
                size="sm"
                variant={a === "cancel" ? "danger" : a === "decline" ? "secondary" : "primary"}
                loading={busy}
                disabled={disabledFor(a)}
                onClick={() => run(`/api/interventions/${encodeURIComponent(wo.id)}`, "PATCH", bodyFor(a))}
              >
                {actionLabel[a]}
              </Button>
            ))}
          </div>
        )}

        {reopenable && (
          <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-3" data-request-closed>
            <p className="text-xs leading-relaxed text-amber-900">{labels.requestClosed}</p>
            <Button size="sm" variant="secondary" className="mt-2" loading={busy} onClick={() => run(`/api/demandes/${encodeURIComponent(ticket.id)}`, "PATCH", { status: "in_progress" })}>
              {labels.reopen}
            </Button>
          </div>
        )}

        {note && (
          <p role="status" className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-800">
            {note}
          </p>
        )}
        {error && (
          <p role="alert" className="mt-3 text-xs font-semibold text-red-700">
            {error}
          </p>
        )}
        {!writable && sampleNote && <p className="mt-3 text-[11px] text-amber-900/80">{sampleNote}</p>}
      </Modal>
    </>
  );
}
