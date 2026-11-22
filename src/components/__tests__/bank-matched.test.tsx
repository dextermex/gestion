// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MotionGlobalConfig } from "motion/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import BankWorkspace, { type TxRow, type WorkspaceLabels } from "@/components/gestion/BankWorkspace";
import { fr } from "@/lib/i18n/fr";

/**
 * A matched bank operation is a payment on a tenancy: the bank screen opens
 * it there, and cancels it from the row, after a confirmation that says
 * what a cancellation does. A refusal (a quittance attests it) is said.
 */
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh }) }));
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

const meta = { label: "Rapproché", color: "bg-emerald-100 text-emerald-800" };
const row = (over: Partial<TxRow> = {}): TxRow => ({
  id: "tx-1",
  status: "manual",
  counterparty: "ANNA WEBER",
  remittance: "Loyer",
  explain: "",
  amountLabel: "1 400,00 €",
  negative: false,
  bookedAt: "2026-11-02",
  dateLabel: "2 nov. 2026",
  tier: null,
  statusMeta: meta,
  paymentHref: "/app/baux/l-1#paiements",
  paymentId: "pay-1",
  ...over,
});

const d = fr.banque;
const labels = {
  views: { all: d.viewAll, review: d.viewReview, auto: d.viewAuto, ignored: d.viewIgnored },
  search: d.searchPlaceholder,
  period: d.periodLabel,
  periods: { all: d.periodAll, "1m": d.period1m, "3m": d.period3m, "6m": d.period6m },
  reset: fr.common.resetFilters,
  reviewTitle: d.reviewTitle,
  reviewCount: fr.dash.todoCount,
  reviewLegal: d.reviewLegal,
  opsTitle: d.opsTitle,
  emptyTitle: d.emptyTitle,
  emptyBody: d.emptyNoAccount,
  filteredTitle: d.filteredTitle,
  filteredBody: d.filteredBody,
  colOperation: d.colCounterparty,
  colDate: d.colDate,
  colStatus: d.colStatus,
  colAmount: d.colAmount,
  countShown: d.countShown,
  payment: {
    open: d.paymentOpen,
    cancel: d.matchCancel,
    cancelBody: fr.baux.paymentCancelBody,
    cancelDo: fr.baux.paymentCancelDo,
    cancelKeep: fr.baux.paymentCancelKeep,
    cancelFailed: fr.baux.paymentCancelFailed,
    receiptIssued: fr.baux.paymentReceiptIssued,
  },
  review: {} as WorkspaceLabels["review"],
} satisfies WorkspaceLabels;

function render(rows: TxRow[]) {
  act(() => {
    root.render(<BankWorkspace labels={labels} rows={rows} review={[]} leases={[]} todayISO="2026-11-20" />);
  });
}
const button = (name: string) => [...host.querySelectorAll("button")].find((b) => b.textContent?.trim() === name);

beforeEach(() => {
  MotionGlobalConfig.skipAnimations = true;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  refresh.mockReset();
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

describe("a matched operation on the bank screen", () => {
  it("opens its payment and cancels it after a confirmation", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    render([row()]);
    const link = [...host.querySelectorAll("a")].find((a) => a.textContent === d.paymentOpen);
    expect(link?.getAttribute("href")).toBe("/app/baux/l-1#paiements");

    act(() => button(d.matchCancel)!.click());
    expect(host.textContent).toContain(fr.baux.paymentCancelBody);
    await act(async () => {
      button(fr.baux.paymentCancelDo)!.click();
    });
    expect(fetchMock).toHaveBeenCalledWith("/api/paiements/pay-1/annulation", expect.objectContaining({ method: "POST" }));
    expect(refresh).toHaveBeenCalled();
  });

  it("says why a cancellation is refused", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "receipt_issued" }), { status: 409 })));
    render([row()]);
    act(() => button(d.matchCancel)!.click());
    await act(async () => {
      button(fr.baux.paymentCancelDo)!.click();
    });
    expect(host.querySelector('[role="alert"]')?.textContent).toBe(fr.baux.paymentReceiptIssued);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("offers nothing on an operation still to review or set aside", () => {
    render([row({ status: "review", paymentHref: null, paymentId: null }), row({ id: "tx-2", status: "ignored", paymentHref: null, paymentId: null })]);
    expect(host.querySelector("[data-matched-actions]")).toBeNull();
  });
});
