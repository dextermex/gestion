// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MotionGlobalConfig } from "motion/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ModifyMenu, { type ModifyLabels } from "@/components/gestion/ModifyMenu";
import type { MenuGroup } from "@/lib/gestion/editors";
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
