// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MotionGlobalConfig } from "motion/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import BillUpload from "@/components/gestion/BillUpload";
import { fr } from "@/lib/i18n/fr";

/**
 * "Ajouter une facture": nothing is filed on a default nobody saw (the lot,
 * the fiscal category), only a file is a piece, and a refusal says which
 * field or what happened.
 */
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
// A 401 is first answered by one renewal of the session in the browser; here it cannot be renewed.
vi.mock("@/lib/supabase/browser", () => ({ renewSessionNow: async () => false }));
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  MotionGlobalConfig.skipAnimations = true;
  window.matchMedia = ((query: string) => ({ matches: false, media: query, onchange: null, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false })) as unknown as typeof window.matchMedia;
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  MotionGlobalConfig.skipAnimations = false;
  vi.unstubAllGlobals();
});

const units = [
  { id: "u-1", label: "Apt 1A · Résidence Beaulieu" },
  { id: "u-2", label: "Apt 2A · Résidence Beaulieu" },
];
const open = async () => {
  await act(async () => root.render(<BillUpload d={fr} inbox="factures@cabinet.morada.lu" suppliers={[]} unitOptions={units} ocr={null} writable sampleNote={null} />));
  await act(async () => host.querySelector<HTMLButtonElement>("[data-bill-add]")!.click());
};
const dialog = () => document.querySelector<HTMLElement>("[role=dialog]")!;
const control = <T extends HTMLElement>(label: string) =>
  [...dialog().querySelectorAll<HTMLLabelElement>("label.ui-field-group")].find((l) => l.querySelector(".ui-field-label")?.textContent === label)!.querySelector<T>("input, select")!;
const set = async (el: HTMLInputElement | HTMLSelectElement, value: string) => {
  const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value);
    el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
  });
};
const send = async () => {
  await act(async () => dialog().querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
};

describe("adding a bill", () => {
  it("chooses no lot and no category for the person, and shows the category and the VAT without opening anything", async () => {
    await open();
    const unit = control<HTMLSelectElement>(fr.finance.billUnit);
    expect(unit.value).toBe("");
    expect(unit.options[0].textContent).toBe(fr.finance.billUnitNone);
    const category = control<HTMLSelectElement>(fr.finance.billCategory);
    expect(category.value).toBe("");
    expect(category.required).toBe(true);
    // Both sit in the form itself, not behind "Plus de détails".
    expect(category.closest("details")).toBeNull();
    expect(control<HTMLSelectElement>(fr.finance.billVat).closest("details")).toBeNull();
  });

  it("takes only a file as a piece: a dragged link chooses nothing", async () => {
    await open();
    const zone = dialog().querySelector<HTMLElement>('[role="button"][aria-label]')!;
    const drop = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(drop, "dataTransfer", { value: { files: [] } });
    await act(async () => zone.dispatchEvent(drop));
    expect(dialog().textContent).not.toContain("facture.pdf");
    expect(zone.textContent).toContain(fr.finance.attach);
  });

  it("names the field the route refuses, and sends the bill on no lot when none was chosen", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ error: "invalid", problem: "amount" }), { status: 400 }));
    vi.stubGlobal("fetch", fetchMock);
    await open();
    await set(control<HTMLInputElement>(fr.finance.billSubject), "Prime annuelle");
    await set(control<HTMLSelectElement>(fr.finance.billCategory), "insurance");
    await set(control<HTMLInputElement>(fr.finance.amountTotal), "abc");
    await send();
    const form = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as FormData;
    expect(form.get("unitId")).toBe("");
    expect(form.get("category")).toBe("insurance");
    expect(dialog().querySelector("[role=alert]")?.textContent).toBe(`Le champ « ${fr.finance.amountTotal} » n'est pas valide.`);
  });

  it("says the limit when the piece is too large, and what to check when no field is named", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "too_large" }), { status: 413 })));
    await open();
    await send();
    expect(dialog().querySelector("[role=alert]")?.textContent).toBe("Le fichier est trop volumineux : 25 Mo au maximum.");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "invalid" }), { status: 400 })));
    await send();
    expect(dialog().querySelector("[role=alert]")?.textContent).toBe(fr.finance.billInvalid);
  });

  it("keeps the form when the session ended, with the way to sign in again beside it", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "unauthenticated" }), { status: 401 })));
    await open();
    await set(control<HTMLInputElement>(fr.finance.billSubject), "Prime annuelle");
    await send();
    const alert = dialog().querySelector("[role=alert]")!;
    expect(alert.textContent).toContain(fr.apiErrors.sessionKeep);
    expect(alert.querySelector("a")?.getAttribute("href")).toBe("/connexion?next=%2Fapp%2Ffinance");
    expect(control<HTMLInputElement>(fr.finance.billSubject).value).toBe("Prime annuelle");
  });

  it("waits for a date that is not a day instead of saving the bill without it", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await open();
    const date = control<HTMLInputElement>(fr.finance.billDocDate);
    await set(date, "32/13/2026");
    await send();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(date);
  });
});
