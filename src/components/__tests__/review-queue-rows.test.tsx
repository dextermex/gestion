// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MotionGlobalConfig } from "motion/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReviewQueue, rowStateOf, type ReviewLabels, type ReviewRow } from "@/components/gestion/ReviewQueue";
import { fr } from "@/lib/i18n/fr";

/**
 * The queue is drawn once and then re-fed by the page: a synchronisation or
 * an imported statement adds operations to a queue already on screen. A row
 * the queue has not met starts like any other, it never breaks the screen.
 */
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

const labels: ReviewLabels = {
  assign: "Affecter au bail",
  pick: "Choisir",
  suggested: "Suggestions",
  others: "Autres baux",
  bind: "Retenir {iban}",
  match: "Rapprocher",
  ignore: "Ignorer",
  matched: "Rapproché",
  matchedWith: "Rapproché avec {lease}",
  boundNote: "IBAN retenu",
  ignored: "Ignoré",
  reopen: "Rouvrir",
  failed: fr.modify.failed,
  already: "Déjà rapproché",
  noLeases: "Aucun bail",
};

const row = (id: string, counterparty: string): ReviewRow => ({
  id,
  counterparty,
  amountLabel: "1 450,00 €",
  remittance: "Loyer",
  dateLabel: "03/11/2026",
  explain: "",
  payerIban: "LU770040004444333322",
  candidates: [{ leaseId: "l-1", label: "Apt 3B · Jean Muller", score: 0.8 }],
});
const leases = [
  { id: "l-1", label: "Apt 3B · Jean Muller" },
  { id: "l-2", label: "Studio · Ana Santos" },
];

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  MotionGlobalConfig.skipAnimations = true;
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  MotionGlobalConfig.skipAnimations = false;
});

describe("the review queue when operations arrive", () => {
  it("shows a row that was not there when the queue was drawn", async () => {
    await act(async () => root.render(<ReviewQueue rows={[row("t-1", "Jean Muller")]} leases={leases} labels={labels} writable={false} />));
    expect(host.querySelectorAll("[data-operation]")).toHaveLength(1);
    // The page re-reads after a sync: the same queue, one more operation.
    await act(async () => root.render(<ReviewQueue rows={[row("t-1", "Jean Muller"), row("t-2", "Ana Santos")]} leases={leases} labels={labels} writable={false} />));
    const rows = [...host.querySelectorAll<HTMLElement>("[data-operation]")];
    expect(rows.map((r) => r.dataset.operation)).toEqual(["t-1", "t-2"]);
    expect(rows[1].textContent).toContain("Ana Santos");
    // The new row starts on the engine's suggestion, like the first one did.
    expect(rows[1].querySelector("select")?.value).toBe("l-1");
  });

  it("lets the manager decide on the new row, and keeps what was decided on the others", async () => {
    await act(async () => root.render(<ReviewQueue rows={[row("t-1", "Jean Muller")]} leases={leases} labels={labels} writable={false} />));
    const ignore = () => [...host.querySelectorAll<HTMLButtonElement>("[data-operation] button")].filter((b) => b.textContent === "Ignorer");
    await act(async () => ignore()[0].click());
    await act(async () => root.render(<ReviewQueue rows={[row("t-1", "Jean Muller"), row("t-2", "Ana Santos")]} leases={leases} labels={labels} writable={false} />));
    const rows = [...host.querySelectorAll<HTMLElement>("[data-operation]")];
    expect(rows[0].className).toContain("is-ignored");
    expect(rows[1].className).not.toContain("is-ignored");
    await act(async () => ignore()[0].click());
    expect([...host.querySelectorAll<HTMLElement>("[data-operation]")][1].className).toContain("is-ignored");
  });

  it("starts an unknown row where every row starts", () => {
    const known = { "t-1": { status: "ignored" as const, leaseId: "", learn: false, error: null, matchedLabel: null, bound: false } };
    expect(rowStateOf(known, row("t-1", "Jean Muller")).status).toBe("ignored");
    expect(rowStateOf(known, row("t-9", "Ana Santos"))).toEqual({ status: "open", leaseId: "l-1", learn: true, error: null, matchedLabel: null, bound: false });
  });
});
