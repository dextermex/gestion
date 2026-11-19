import { LUX_TIME_ZONE } from "@/lib/clock";
import type { RequestStatus } from "@/lib/portal/types";
import type { TicketStatus, WorkOrderStatus } from "@/lib/types";

/**
 * An intervention's progression, as the artisan side moves: a work order is
 * offered, handed to an artisan, scheduled, done, invoiced, paid; or the
 * artisan declines, or the desk cancels. The ticket the tenant watches
 * follows the work order, so the same fact never has two states. The table
 * below is the only place a step is allowed or refused.
 *
 * A request's status has two doors: these steps (Interventions) and the
 * four statuses of Messages. Both go through this module, so the ticket
 * means the same thing whichever screen moved it: a step never sends a
 * request backwards, never reopens one that was resolved or refused (that
 * takes an explicit action), and never moves the day it was closed.
 * Cancelling an intervention does not refuse the tenant's request.
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

/** A ticket that takes no more work: resolved (done, closed) or refused (cancelled). */
export function isTicketClosed(status: TicketStatus): boolean {
  return status === "done" || status === "closed" || status === "cancelled";
}

/** How far along an open ticket is: a step only ever moves it forward. */
const PROGRESS: Record<TicketStatus, number> = { new: 0, triaged: 1, offered: 2, scheduled: 3, in_progress: 4, pending_tenant: 4, done: 5, closed: 6, cancelled: 6 };

/** What a write does to the day the ticket was closed: date it, leave it as it is, or clear it (the ticket is open again). */
export type Closure = "set" | "keep" | "clear";

export interface TicketFollow {
  status: TicketStatus;
  closure: Closure;
}

/**
 * What a step of the work order does to its ticket, given where the ticket
 * stands. `request_closed` refuses the step: the request was resolved or
 * refused meanwhile, and work on it resumes only once it is reopened.
 *
 * - Handing over, planning, an artisan declining: the ticket moves forward
 *   to the step's status, or stays where it is when it was already further
 *   (a request the desk marked in progress is not sent back to "qualified").
 * - Work done, invoiced, paid: the ticket is resolved; the day it was
 *   closed is set once and kept by the later steps.
 * - Cancelling the intervention: a ticket raised at the desk is cancelled
 *   with it; a tenant's request stays open, without its visit.
 */
export function ticketAfterStep(action: WorkOrderAction, ticket: { status: TicketStatus; source: string }): TicketFollow | "request_closed" {
  const closed = isTicketClosed(ticket.status);
  const target = TRANSITIONS[action].ticket;
  if (action === "assign" || action === "schedule" || action === "decline") {
    if (closed) return "request_closed";
    return { status: PROGRESS[target] > PROGRESS[ticket.status] ? target : ticket.status, closure: "clear" };
  }
  if (action === "cancel") {
    if (closed) return { status: ticket.status, closure: "keep" };
    if (ticket.source !== "tenant") return { status: "cancelled", closure: "set" };
    // The request stands; what only an intervention explained (offered, planned) falls back to "taken in charge".
    return { status: ticket.status === "offered" || ticket.status === "scheduled" ? "triaged" : ticket.status, closure: "keep" };
  }
  // done, invoice, paid
  if (ticket.status === "cancelled") return "request_closed";
  return { status: action === "paid" || ticket.status === "closed" ? "closed" : "done", closure: closed ? "keep" : "set" };
}

/** A closing step the work order already took: asked again, only the ticket is brought along (the first attempt stopped halfway). */
export function stepAlreadyTaken(current: WorkOrderStatus, action: WorkOrderAction): boolean {
  return (action === "done" || action === "invoice" || action === "paid") && TRANSITIONS[action].to === current;
}

/**
 * What the desk's four statuses (Messages) write on a ticket, given where
 * it stands and its work order. `held` says the status asked for could not
 * be the ticket's: an intervention is under way or behind, so the request
 * is in progress whatever was asked.
 *
 * - Resolved, refused: the ticket is closed; the day is set once and kept
 *   when the same closure is asked again.
 * - To handle, in progress on a closed request: the explicit reopening.
 *   The work order says where the request stands (handed over, planned, or
 *   work already done once); without one it is new, or in progress.
 */
export function ticketForRequestStatus(asked: RequestStatus, ticket: { status: TicketStatus; workOrder: WorkOrderStatus | null }): TicketFollow & { held: boolean } {
  const { status, workOrder } = ticket;
  if (asked === "resolved") return { status: status === "closed" ? "closed" : "done", closure: status === "done" || status === "closed" ? "keep" : "set", held: false };
  if (asked === "refused") return { status: "cancelled", closure: status === "cancelled" ? "keep" : "set", held: false };
  const byOrder: TicketStatus | null =
    workOrder === "accepted" || workOrder === "slots_proposed" ? "triaged" : workOrder === "scheduled" ? "scheduled" : workOrder === "done" || workOrder === "invoiced" || workOrder === "paid" ? "in_progress" : null;
  // Already open and under way: nothing to flatten (a planned request stays planned).
  const underWay = !isTicketClosed(status) && status !== "new";
  if (asked === "todo" && !byOrder) return { status: "new", closure: "clear", held: false };
  return { status: underWay ? status : (byOrder ?? "in_progress"), closure: "clear", held: asked === "todo" };
}

/**
 * A visit is planned for a day, and for an hour only when the desk entered
 * one. The work order keeps a single instant, so a day with no hour is
 * written as noon UTC and one second: the calendar day is the same in
 * Luxembourg and in UTC, and the odd second (no hour a person enters has
 * one) says that nobody chose an hour, so no screen prints one.
 */
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const HOUR = /^([01]\d|2[0-3]):[0-5]\d$/;
const NO_HOUR = /T12:00:01(\.0+)?(Z|[+-]00:?00)$/;

/** Minutes Luxembourg's clock is ahead of UTC at an instant. */
function luxOffsetMinutes(at: Date): number {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: LUX_TIME_ZONE, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(at);
  const n = (type: string): number => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const wall = Date.UTC(n("year"), n("month") - 1, n("day"), n("hour"), n("minute"));
  return Math.round((wall - at.getTime()) / 60000);
}

/** The instant a visit is kept at: the day and the hour on Luxembourg's clock, or the day alone. Null when either is not one. */
export function visitInstant(day: string, time: string | null): string | null {
  if (!DAY.test(day) || Number.isNaN(Date.parse(`${day}T00:00:00Z`))) return null;
  if (!time) return `${day}T12:00:01.000Z`;
  if (!HOUR.test(time)) return null;
  const wall = Date.parse(`${day}T${time}:00Z`);
  // The offset at the wall time read as UTC is right except within hours of a clock change: looked up again at the instant found.
  const guess = wall - luxOffsetMinutes(new Date(wall)) * 60000;
  return new Date(wall - luxOffsetMinutes(new Date(guess)) * 60000).toISOString();
}

/** Whether a planned visit carries an hour somebody chose. */
export function visitHasHour(iso: string): boolean {
  return iso.length > 10 && !NO_HOUR.test(iso);
}

/** The hour of a planned visit on Luxembourg's clock, "HH:MM", for the field that edits it; empty when none was chosen. */
export function visitHour(iso: string): string {
  if (!visitHasHour(iso)) return "";
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  if (!/(Z|[+-]\d{2}:?\d{2})$/.test(iso)) return iso.slice(11, 16);
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: LUX_TIME_ZONE, hourCycle: "h23", hour: "2-digit", minute: "2-digit" }).formatToParts(at);
  return `${parts.find((p) => p.type === "hour")?.value ?? "00"}:${parts.find((p) => p.type === "minute")?.value ?? "00"}`;
}
