// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import EdlWizard from "@/components/gestion/EdlWizard";
import { memoryDraftBackend, readDraft, setDraftBackend, writeDraft } from "@/lib/draft";
import { fr } from "@/lib/i18n/fr";

/**
 * The état des lieux on a phone: the walk-through is kept on the device as
 * it goes and offered back after a reload, each photograph shows as a
 * thumbnail that can be taken away, and the position in the walk is always
 * on the screen.
 */
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("motion/react", () => ({
  useReducedMotion: () => true,
  AnimatePresence: ({ children }: { children: React.ReactNode }) => children,
  motion: { div: ({ children, className }: { children: React.ReactNode; className?: string }) => <div className={className}>{children}</div> },
}));
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLDivElement;
let urls = 0;

beforeEach(() => {
  setDraftBackend(memoryDraftBackend());
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  urls = 0;
  vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: () => `blob:photo-${++urls}`, revokeObjectURL: () => {} }));
  window.history.replaceState(null, "", "/app/biens/etat-des-lieux?bail=l-1&type=exit");
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  setDraftBackend(null);
  vi.unstubAllGlobals();
});

const render = async () => {
  await act(async () =>
    root.render(
      <EdlWizard
        d={fr}
        leaseId="l-1"
        kind="exit"
        unitLabel="Apt 3B"
        propertyId="p-1"
        propertyName="Résidence Beaulieu"
        meters={[]}
        suggestedRooms={["Entrée", "Séjour"]}
        real={false}
        notice="demo"
      />,
    ),
  );
  // The draft read and the portal both land after the first paint.
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
};
const button = (text: string | RegExp) => [...document.querySelectorAll("button")].find((b) => (typeof text === "string" ? b.textContent === text : text.test(b.textContent ?? "")))!;
const click = async (text: string | RegExp) => {
  const b = button(text);
  expect(b, String(text)).toBeTruthy();
  await act(async () => b.click());
};

describe("the état des lieux on a phone", () => {
  it("offers the draft the device holds and picks the walk up where it stopped", async () => {
    await writeDraft("edl:l-1:exit", 1, {
      rooms: [{ key: "r7", name: "Cave", items: { paint: { condition: "poor", notes: "fissure au plafond" } } }],
      readings: {},
      keysHandedOver: false,
      observations: "",
      signed: false,
      completedAt: "2026-10-08",
      step: 1,
      photos: {},
    });
    await render();
    const prompt = document.querySelector("[data-draft-prompt]");
    expect(prompt?.textContent).toContain("brouillon");
    await click(fr.common.draftResume);
    expect(document.querySelector("h1")?.textContent).toBe("Cave");
    const used = [...document.querySelectorAll("[data-conditions='paint'] button")].find((b) => b.textContent === fr.edlWizard.condition.poor)!;
    expect(used.getAttribute("aria-pressed")).toBe("true");
    expect((document.querySelector("input[placeholder='" + fr.edlWizard.notePlaceholder + "']") as HTMLInputElement).value).toBe("fissure au plafond");
    expect(document.querySelector("[data-draft-prompt]")).toBeNull();
  });

  it("starts again on request, and the draft is gone", async () => {
    await writeDraft("edl:l-1:exit", 1, { rooms: [{ key: "r1", name: "Cave", items: {} }], readings: {}, keysHandedOver: false, observations: "", signed: false, completedAt: "2026-10-08", step: 0, photos: {} });
    await render();
    await click(fr.common.draftDiscard);
    expect(document.querySelector("[data-draft-prompt]")).toBeNull();
    expect(await readDraft("edl:l-1:exit", 1)).toBeNull();
    expect(document.querySelector("h1")?.textContent).toBe(fr.edlWizard.roomsTitle);
  });

  it("keeps the walk on the device as it goes", async () => {
    await render();
    await click(fr.common.next);
    await click(fr.edlWizard.condition.good);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 700));
    });
    const draft = await readDraft<{ step: number; rooms: Array<{ name: string; items: Record<string, { condition: string }> }> }>("edl:l-1:exit", 1);
    expect(draft?.data.step).toBe(1);
    expect(draft?.data.rooms[0].items.paint.condition).toBe("good");
  });

  it("shows each photograph as a thumbnail that can be taken away, and says where the walk is", async () => {
    await render();
    await click(fr.common.next);
    expect(document.body.textContent).toContain(fr.biens.wizStepOf.replace("{n}", "2").replace("{total}", "5"));
    await click(fr.edlWizard.condition.good);
    const input = document.querySelector("input[data-photo-input='paint']") as HTMLInputElement;
    const file = new File([new Uint8Array(64)], "mur.jpg", { type: "image/jpeg" });
    Object.defineProperty(input, "files", { value: [file] });
    await act(async () => {
      input.dispatchEvent(new Event("change", { bubbles: true }));
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(document.querySelector("[data-photo-count='paint']")?.textContent).toContain("1 photo");
    const img = document.querySelector("[data-photo-list='paint'] img") as HTMLImageElement;
    expect(img.getAttribute("src")).toBe("blob:photo-1");
    await act(async () => (document.querySelector("[data-photo-list='paint'] button") as HTMLButtonElement).click());
    expect(document.querySelector("[data-photo-list='paint']")).toBeNull();
    expect(document.querySelector("[data-photo-count='paint']")).toBeNull();
  });
});
