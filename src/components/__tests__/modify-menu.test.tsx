// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MotionGlobalConfig } from "motion/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ModifyMenu, { type ModifyLabels } from "@/components/gestion/ModifyMenu";
import type { EditTopic, MenuGroup } from "@/lib/gestion/editors";
import { ApiErrorsProvider } from "@/components/gestion/ApiErrors";
import { fr } from "@/lib/i18n/fr";

/**
 * The Modifier menu: on a phone its entries come up as a sheet from the
 * foot of the screen, each a thumb's size, and an entry opens its editor
 * over it; on a laptop the same entries hang under the button as a
 * dropdown. Which one is the stylesheet's phone query, read once.
 */
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
let phone = true;

/** The labels as the property sheet hands them (src/app/app/biens/[id]/sheet.tsx). */
const labels: ModifyLabels = {
  trigger: fr.modify.trigger,
  cancel: fr.common.cancel,
  close: fr.common.close,
  save: fr.common.save,
  saved: fr.modify.saved,
  failed: fr.modify.failed,
  emailTaken: fr.modify.emailTaken,
  schemaOutdated: fr.modify.schemaOutdated,
  datePlaceholder: fr.loyers.datePlaceholder,
  photoCurrent: fr.modify.photoCurrent,
  photoChoose: fr.modify.photoChoose,
  photoRemove: fr.modify.photoRemove,
  photoNone: fr.modify.photoNone,
  payerAdd: fr.modify.payerAdd,
  payerIban: fr.location.payerIban,
  payerNone: fr.modify.payerNone,
  payerHint: fr.location.payerHint,
  remove: fr.modify.remove,
  indexApply: fr.modify.indexApply,
  indexBlocked: fr.modify.indexBlocked,
  indexFrom: fr.modify.indexTo,
  indexTo: fr.modify.indexTo,
  archiveConfirm: fr.modify.archive,
  archiveBody: fr.modify.archiveBody,
  archiveBlocked: fr.modify.archiveBlocked,
  archiveDo: fr.modify.archiveDo,
};

const groups: MenuGroup[] = [
  {
    label: "Le bien",
    entries: [
      { id: "photos", label: "Photos", special: { kind: "photos", propertyId: "p-1", currentUrl: null } },
      { id: "archive", label: "Archiver le bien", special: { kind: "archive", propertyId: "p-1", propertyName: "Résidence Beaulieu", blocked: false } },
    ],
  },
  { label: "Ailleurs", entries: [{ id: "lots", label: "Les lots", href: "/app/biens/p-1?onglet=lots" }] },
];

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  phone = true;
  MotionGlobalConfig.skipAnimations = true;
  window.matchMedia = ((query: string) => ({
    matches: phone && query.includes("max-width: 639.98px"),
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  MotionGlobalConfig.skipAnimations = false;
});

const render = async () => {
  await act(async () => root.render(<ModifyMenu groups={groups} labels={labels} />));
};
const trigger = () => host.querySelector<HTMLButtonElement>("button[aria-haspopup]")!;

describe("the Modifier menu", () => {
  it("is a sheet of entries on a phone, and an entry opens its editor over it", async () => {
    await render();
    expect(trigger().getAttribute("aria-haspopup")).toBe("dialog");
    await act(async () => trigger().click());
    const sheet = document.querySelector("[role=dialog]");
    expect(sheet).not.toBeNull();
    expect(sheet?.getAttribute("aria-label")).toBe(fr.modify.trigger);
    expect(document.querySelector("[role=menu]")).toBeNull();
    const rows = [...document.querySelectorAll<HTMLElement>("[data-modify-sheet] a, [data-modify-sheet] button")];
    expect(rows.map((r) => r.textContent?.trim())).toEqual(["Photos", "Archiver le bien", "Les lots"]);
    expect(rows[2].getAttribute("href")).toBe("/app/biens/p-1?onglet=lots");
    await act(async () => rows[1].click());
    const editor = [...document.querySelectorAll("[role=dialog]")].find((d) => d.getAttribute("aria-label") === "Archiver le bien");
    expect(editor).not.toBeUndefined();
    expect(editor?.textContent).toContain(fr.modify.archiveDo);
    expect(document.querySelector("[data-modify-sheet]")).toBeNull();
  });

  it("hangs under the button as a dropdown on a laptop", async () => {
    phone = false;
    await render();
    expect(trigger().getAttribute("aria-haspopup")).toBe("menu");
    await act(async () => trigger().click());
    expect(document.querySelector("[role=dialog]")).toBeNull();
    const menu = document.querySelector("[role=menu]");
    expect(menu).not.toBeNull();
    expect([...menu!.querySelectorAll("[role=menuitem]")].map((e) => e.textContent?.trim())).toEqual(["Photos", "Archiver le bien", "Les lots"]);
  });
});

/**
 * An editor behind Modifier: it opens on the stored values, a date reads
 * day, month, year, a save sends only what changed, and a refusal is said
 * in words with the form left as typed.
 */
describe("an editor behind Modifier", () => {
  const guarantee: EditTopic = {
    id: "deposit",
    title: "Garantie",
    endpoint: "/api/garanties/dep-1",
    method: "PATCH",
    fields: [
      { kind: "euro", name: "amount", label: "Montant", value: "2 900,00" },
      { kind: "select", name: "status", label: "État", value: "held", options: [{ value: "held", label: "Détenue" }, { value: "disputed", label: "Contestée" }] },
      { kind: "date", name: "receivedOn", label: "Reçue le", value: "2024-03-01", max: "2026-11-19" },
    ],
  };
  const editorGroups: MenuGroup[] = [{ label: "Location", entries: [{ id: "deposit", label: "Garantie", topic: guarantee }] }];

  const openEditor = async () => {
    phone = false;
    await act(async () =>
      root.render(
        <ApiErrorsProvider copy={fr.apiErrors}>
          <ModifyMenu groups={editorGroups} labels={labels} />
        </ApiErrorsProvider>,
      ),
    );
    await act(async () => trigger().click());
    await act(async () => document.querySelector<HTMLElement>("[role=menuitem]")!.click());
    return document.querySelector<HTMLElement>("[role=dialog]")!;
  };
  const set = async (el: HTMLInputElement | HTMLSelectElement, value: string) => {
    const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    await act(async () => {
      Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value);
      el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
    });
  };
  const save = async (dialog: HTMLElement) => {
    await act(async () => dialog.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  };

  afterEach(() => vi.unstubAllGlobals());

  it("opens a date as day, month, year, on the stored day", async () => {
    const dialog = await openEditor();
    const date = dialog.querySelector<HTMLInputElement>("input[data-day]")!;
    expect(date.type).toBe("text");
    expect(date.value).toBe("01/03/2024");
    expect(date.placeholder).toBe(fr.loyers.datePlaceholder);
  });

  it("sends only the field that changed, never the date nobody retyped", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const dialog = await openEditor();
    await set(dialog.querySelector<HTMLSelectElement>("select")!, "disputed");
    await save(dialog);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/garanties/dep-1");
    expect(JSON.parse(String(init.body))).toEqual({ status: "disputed" });
  });

  it("closes without a request when nothing changed", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const dialog = await openEditor();
    await save(dialog);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(document.querySelector("[role=dialog]")).toBeNull();
  });

  it("waits for a date that is not a day instead of erasing the stored one", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const dialog = await openEditor();
    const date = dialog.querySelector<HTMLInputElement>("input[data-day]")!;
    await set(date, "31/02/2024");
    await save(dialog);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(date);
  });

  it("says in words why a save is refused, and keeps the form as typed", async () => {
    const dialog = await openEditor();
    const amount = dialog.querySelector<HTMLInputElement>("input:not([data-day])")!;
    await set(amount, "3 000,00");
    for (const [status, body, sentence] of [
      [403, { error: "forbidden" }, fr.apiErrors.forbidden],
      [402, { error: "subscription_required" }, fr.apiErrors.subscription],
      [409, { error: "refused" }, fr.apiErrors.conflicts.refused],
      [400, { error: "invalid", field: "amount" }, "Le champ « Montant » n'est pas valide."],
      [503, { error: "schema_outdated" }, fr.modify.schemaOutdated],
      [401, { error: "unauthenticated" }, fr.apiErrors.sessionKeep],
      [502, { error: "storage_failed" }, fr.modify.failed],
    ] as const) {
      vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(body), { status })));
      await save(dialog);
      expect(dialog.querySelector("[role=alert]")?.textContent, String(status)).toContain(sentence);
      expect(amount.value).toBe("3 000,00");
    }
    // The session that ended is signed in again beside the form.
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "unauthenticated" }), { status: 401 })));
    await save(dialog);
    expect(dialog.querySelector("[role=alert] a")?.getAttribute("target")).toBe("_blank");
  });
});
