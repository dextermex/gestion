import type { TicketStatus, WorkOrderStatus } from "@/lib/types";

/**
 * An intervention's progression, as the artisan side moves: a work order is
 * offered, handed to an artisan, scheduled, done, invoiced, paid; or the
 * artisan declines, or the desk cancels. The ticket the tenant watches
 * follows the work order, so the same fact never has two states. The table
 * below is the only place a step is allowed or refused.
 */
export type WorkOrderAction = "assign" | "schedule" | "done" | "invoice" | "paid" | "decline" | "cancel";

export const WORK_ORDER_ACTIONS: readonly WorkOrderAction[] = ["assign", "schedule", "done", "invoice", "paid", "decline", "cancel"];

const TRANSITIONS: Record<WorkOrderAction, { from: readonly WorkOrderStatus[]; to: WorkOrderStatus; ticket: TicketStatus }> = {
  assign: { from: ["offered", "declined", "accepted", "slots_proposed"], to: "accepted", ticket: "triaged" },
  schedule: { from: ["accepted", "slots_proposed", "scheduled"], to: "scheduled", ticket: "scheduled" },
  done: { from: ["scheduled", "accepted"], to: "done", ticket: "done" },
  invoice: { from: ["done"], to: "invoiced", ticket: "done" },
  paid: { from: ["invoiced"], to: "paid", ticket: "closed" },
  decline: { from: ["offered", "accepted", "slots_proposed"], to: "declined", ticket: "offered" },
  cancel: { from: ["offered", "declined", "accepted", "slots_proposed", "scheduled"], to: "declined", ticket: "cancelled" },
};

export interface WorkOrderStep {
  status: WorkOrderStatus;
  ticketStatus: TicketStatus;
  /** True when the ticket's closure date is set by this step, false when it is cleared. */
  closes: boolean;
}

/** The step, or null when the action is not allowed from where the work order stands. */
export function nextWorkOrderStep(current: WorkOrderStatus, action: WorkOrderAction): WorkOrderStep | null {
  const t = TRANSITIONS[action];
  if (!t.from.includes(current)) return null;
  return { status: t.to, ticketStatus: t.ticket, closes: t.ticket === "closed" || t.ticket === "cancelled" || t.ticket === "done" };
}

/** What a screen may offer from a state: the actions the table allows. */
export function allowedWorkOrderActions(current: WorkOrderStatus): WorkOrderAction[] {
  return WORK_ORDER_ACTIONS.filter((a) => TRANSITIONS[a].from.includes(current));
}
