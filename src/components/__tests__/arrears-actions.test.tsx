// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import ArrearsActions, { type ArrearsLabels, type ArrearsStep } from "@/components/gestion/ArrearsActions";
import { fr } from "@/lib/i18n/fr";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  refresh.mockClear();
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

const l = fr.loyers;
const labels: ArrearsLabels = {
  record: l.arrearsRecord, doneOn: l.arrearsDoneOn, dispatchedOn: l.arrearsDispatchedOn, confirmMed: l.arrearsConfirmMed, arOn: l.arrearsArOn, saveAr: l.arrearsSaveAr,
  awaitingAr: l.arrearsAwaitingAr, arReceived: l.arrearsArReceived, medRecorded: l.arrearsMedRecorded, justiceRecord: l.arrearsJusticeRecord, justiceDone: l.arrearsJusticeDone,
  stepDone: l.arrearsStepDone, failed: l.arrearsFailed, already: l.arrearsAlready, needsAr: l.arrearsNeedsAr, sampleConfirmed: l.arrearsConfirmed, datePlaceholder: l.datePlaceholder,
};
const ladder = (next: ArrearsStep | null, awaitingLetter: { id: string; dispatchedOn: string } | null = null) => (
  <ArrearsActions leaseId="lease-1" rentPeriodId="rp-1" next={next} awaitingLetter={awaitingLetter} todayISO="2026-11-19" stageLabel="Mise en demeure" locale="fr" writable sampleNote={null} labels={labels} />
);
const button = (name: string) => [...host.querySelectorAll("button")].find((b) => b.textContent?.includes(name));

it("keeps the confirmation of a recorded step and shows the next control once the ladder has been re-read", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "Content-Type": "application/json" } })));
  await act(async () => root.render(ladder("mise_en_demeure")));
  await act(async () => button(l.arrearsConfirmMed)!.click());
  // Recorded: the confirmation, the page asked to re-read, and no second chance to press the same button.
  expect(host.querySelector('[role="status"]')?.textContent).toContain("Mise en demeure enregistrée");
  expect(refresh).toHaveBeenCalledTimes(1);
  expect(button(l.arrearsConfirmMed)).toBeUndefined();
  // The page comes back with the letter awaiting its AR: the field for it is there, without a reload.
  await act(async () => root.render(ladder(null, { id: "letter-1", dispatchedOn: "2026-11-19" })));
  expect(host.querySelector('[role="status"]')?.textContent).toContain("Mise en demeure enregistrée");
  expect(button(l.arrearsSaveAr)).toBeDefined();
  expect(host.querySelector("input[data-day]")).not.toBeNull();
});

it("returns to the same month, view and row after a session that ran out", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 401 })));
  const assign = vi.fn();
  vi.stubGlobal("location", { href: "http://localhost/app/loyers?mois=2026-10&vue=impayes", assign });
  await act(async () => root.render(ladder("friendly")));
  await act(async () => button(l.arrearsRecord)!.click());
  expect(assign).toHaveBeenCalledWith(`/connexion?next=${encodeURIComponent("/app/loyers?mois=2026-10&vue=impayes&ouvrir=rp-1")}`);
});
