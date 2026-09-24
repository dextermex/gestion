"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button, Field, Input, Modal, Select } from "@/components/pro/ui";
import { allowedWorkOrderActions, type WorkOrderAction } from "@/lib/gestion/interventions";
import type { Locale } from "@/lib/i18n/config";
import { euros, formatDate, type Meta, type WorkOrderStatus } from "@/lib/types";
import { callJson } from "./call";

/**
 * One intervention, opened from its row: the ticket and the work order
 * behind it, the artisan, the date, the amounts, and the steps the ladder
 * allows from where it stands. Each step is written on the work order and
 * the ticket follows; the page re-reads both. A request that has no work
 * order yet gets one here (the same doorway Messages uses).
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
  close: string;
  colStatus: string;
}

export interface SheetTicket {
  id: string;
  ref: string;
  title: string;
  unitLabel: string;
  workOrder: { id: string; status: WorkOrderStatus; artisanContactId: string | null; scheduledAt: string | null; amountCents: number | null; vatCents: number | null } | null;
}

const BACK = "/app/interventions";
const ORDER: WorkOrderAction[] = ["assign", "schedule", "done", "invoice", "paid", "decline", "cancel"];

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
  const [scheduledAt, setScheduledAt] = useState(wo?.scheduledAt ? wo.scheduledAt.slice(0, 10) : todayISO);
  const [amount, setAmount] = useState(wo?.amountCents != null ? (wo.amountCents / 100).toFixed(2).replace(".", ",") : "");
  const [vat, setVat] = useState(wo?.vatCents != null ? (wo.vatCents / 100).toFixed(2).replace(".", ",") : "");

  const run = async (url: string, method: string, body: Record<string, unknown> | undefined) => {
    setNote(null);
    if (!writable) {
      setNote(labels.done);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await callJson(url, method, body, BACK);
      if (!res) return;
      if (res.ok) {
        setNote(labels.done);
        router.refresh();
      } else setError(res.status === 409 ? labels.refused : labels.failed);
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
  const allowed = wo ? allowedWorkOrderActions(wo.status) : [];
  const disabledFor = (a: WorkOrderAction) => (a === "assign" ? !artisan : a === "schedule" ? !scheduledAt : a === "invoice" ? !amount.trim() : false);
  const bodyFor = (a: WorkOrderAction): Record<string, unknown> =>
    a === "assign" ? { action: a, artisanContactId: artisan } : a === "schedule" ? { action: a, scheduledAt } : a === "invoice" ? { action: a, amount: amount.trim(), vat: vat.trim() } : { action: a };

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
            <Field label={labels.amount}>
              <Input value={amount} inputMode="decimal" placeholder="0,00" onChange={(e) => setAmount(e.target.value)} disabled={busy} />
            </Field>
            <Field label={labels.vat}>
              <Input value={vat} inputMode="decimal" placeholder="0,00" onChange={(e) => setVat(e.target.value)} disabled={busy} />
            </Field>
            {artisans.length === 0 && <p className="text-xs text-ink-soft sm:col-span-2">{labels.artisanNoneYet}</p>}
            {(wo.scheduledAt || wo.amountCents != null) && (
              <p className="text-xs text-ink-soft sm:col-span-2">
                {wo.scheduledAt ? `${labels.scheduledOn} ${formatDate(wo.scheduledAt.slice(0, 10), locale)}` : ""}
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
