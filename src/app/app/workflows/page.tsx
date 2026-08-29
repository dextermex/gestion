import { Badge, Card, PageHeader } from "@/components/pro/ui";
import { LegalNote, MetaBadge, Panel } from "@/components/gestion/bits";
import { getDemo } from "@/lib/demo";
import {
  WORKFLOW_STATES,
  euros,
  formatDate,
  ticketSeverityMeta,
  ticketStatusMeta,
  workflowStateLabel,
} from "@/lib/types";
import { getI18n } from "@/lib/i18n";
import { fmt } from "@/lib/i18n/config";
import type { Dict } from "@/lib/i18n/fr";

function Stepper({ states, current, d }: { states: string[]; current: string; d: Dict }) {
  const idx = states.indexOf(current);
  return (
    <div className="mt-3">
      <ol className="flex items-center gap-1" aria-label={d.workflows.stepsAria}>
        {states.map((s, i) => (
          <li key={s} className="min-w-0 flex-1" aria-current={i === idx ? "step" : undefined}>
            <span
              className={
                "block h-1 rounded-full " + (i < idx ? "bg-brand-300" : i === idx ? "bg-brand-600" : "bg-sand-200")
              }
              title={workflowStateLabel(d, s)}
            />
            <span className="sr-only">{workflowStateLabel(d, s)}</span>
          </li>
        ))}
      </ol>
      {/* The active step gets the whole row to say its name — a label pinned
          under its own segment truncated after four letters. */}
      <div className="mt-1.5 flex items-baseline justify-between gap-2">
        <span className="min-w-0 text-[11px] font-bold text-brand-800">
          {workflowStateLabel(d, states[idx] ?? current)}
        </span>
        <span className="shrink-0 text-[10px] font-medium tabular-nums text-ink-soft">
          {idx + 1}/{states.length}
        </span>
      </div>
    </div>
  );
}

export default async function WorkflowsPage() {
  const { locale, d } = await getI18n();
  const { TICKETS, WORKFLOWS } = await getDemo();
  const severityMeta = ticketSeverityMeta(d);
  const statusMeta = ticketStatusMeta(d);
  const moveIns = WORKFLOWS.filter((w) => w.kind === "move_in");
  const moveOuts = WORKFLOWS.filter((w) => w.kind === "move_out");
  const openTickets = TICKETS.filter((t) => !["done", "closed", "cancelled"].includes(t.status));

  return (
    <div>
      <PageHeader title={d.workflows.title} subtitle={d.workflows.subtitle} />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Panel title={d.workflows.moveInTitle}>
          <ul className="space-y-4">
            {moveIns.map((w) => (
              <li key={w.id} className="rounded-xl border border-sand-200 p-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="min-w-0 truncate text-sm font-semibold text-ink">{w.label}</p>
                  {w.blockedReason ? (
                    <Badge className="bg-amber-100 text-amber-800">{d.status.blocked}</Badge>
                  ) : (
                    <Badge className="bg-sky-100 text-sky-800">{workflowStateLabel(d, w.currentState)}</Badge>
                  )}
                </div>
                <Stepper states={WORKFLOW_STATES.move_in} current={w.currentState} d={d} />
                {w.blockedReason && (
                  <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">{w.blockedReason}</p>
                )}
              </li>
            ))}
          </ul>
          <LegalNote>{d.workflows.moveInLegal}</LegalNote>
        </Panel>

        <Panel title={d.workflows.moveOutTitle}>
          <ul className="space-y-4">
            {moveOuts.map((w) => (
              <li key={w.id} className="rounded-xl border border-sand-200 p-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="min-w-0 truncate text-sm font-semibold text-ink">{w.label}</p>
                  {w.blockedReason ? (
                    <Badge className="bg-amber-100 text-amber-800">{d.status.warning}</Badge>
                  ) : (
                    <Badge className="bg-sky-100 text-sky-800">{workflowStateLabel(d, w.currentState)}</Badge>
                  )}
                </div>
                <Stepper states={WORKFLOW_STATES.move_out} current={w.currentState} d={d} />
                {w.blockedReason && (
                  <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">{w.blockedReason}</p>
                )}
              </li>
            ))}
          </ul>
          <LegalNote>{d.workflows.moveOutLegal}</LegalNote>
        </Panel>
      </div>

      <Panel title={d.workflows.ticketsTitle} className="mt-5">
        <Card className="overflow-hidden border-0 shadow-none">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-sand-100 bg-sand-50/60 text-left text-[11px] uppercase tracking-wide text-ink-soft">
                  <th className="px-4 py-2.5 font-semibold">{d.workflows.colRef}</th>
                  <th className="px-3 py-2.5 font-semibold">{d.workflows.colUnit}</th>
                  <th className="px-3 py-2.5 text-right font-semibold">{d.workflows.colSla}</th>
                  <th className="px-3 py-2.5 text-right font-semibold">{d.workflows.colSeverity}</th>
                  <th className="px-4 py-2.5 text-right font-semibold">{d.workflows.colStatus}</th>
                </tr>
              </thead>
              <tbody>
                {openTickets.map((t) => (
                  <tr key={t.id} className="border-b border-sand-50 last:border-0 hover:bg-sand-50/50">
                    <td className="px-4 py-3">
                      <p className="font-semibold text-ink">{t.ref}</p>
                      <p className="text-xs text-ink-soft">{t.title}</p>
                    </td>
                    <td className="px-3 py-3 text-xs text-ink-soft">{t.unitLabel}</td>
                    <td className="px-3 py-3 text-right text-xs tabular-nums text-ink-soft">
                      {t.slaDueAt ? formatDate(t.slaDueAt, locale) : "—"}
                    </td>
                    <td className="px-3 py-3 text-right">
                      <MetaBadge meta={severityMeta[t.severity]} />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <MetaBadge meta={statusMeta[t.status]} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
          {TICKETS.filter((t) => t.rechargeDecision).map((t) => (
            <div key={t.id} className="rounded-xl border border-sand-200 p-3.5">
              <p className="text-xs font-semibold uppercase tracking-wide text-ink-soft">
                {t.ref}
                {t.amountCents ? ` · ${euros(t.amountCents, locale)}` : ""}
              </p>
              <p className="mt-1 text-sm font-semibold text-ink">
                {fmt(d.workflows.rechargeLabel, {
                  who:
                    t.rechargeDecision!.decision === "owner"
                      ? d.workflows.rechargeOwner
                      : t.rechargeDecision!.decision === "tenant"
                        ? d.workflows.rechargeTenant
                        : d.workflows.rechargeSplit,
                })}
              </p>
              <p className="mt-1 text-xs leading-relaxed text-ink-soft">{t.rechargeDecision!.note}</p>
            </div>
          ))}
        </div>
        <LegalNote>{d.workflows.ticketsLegal}</LegalNote>
      </Panel>
    </div>
  );
}
