// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MotionGlobalConfig } from "motion/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Modal } from "@/components/pro/ui";

/**
 * The house dialog on a phone is a sheet that can be pulled back down. The
 * test drives its header with a finger the way a phone reports one
 * (pointer events of type "touch", each with its time), on a sheet 400px
 * tall: a long pull and a flick close it, a short slow pull and a pull
 * taken back leave it open, a mouse never drags it, and above `sm` (the
 * centred dialog) there is nothing to pull.
 */
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
let phone = true;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  phone = true;
  // Every animation lands at once: the sheet has risen by the time the finger arrives.
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

async function openSheet(): Promise<{ closed: () => number; header: HTMLElement }> {
  let closes = 0;
  await act(async () =>
    root.render(
      <Modal open onClose={() => (closes += 1)} title="Plus">
        <p>Demandes</p>
      </Modal>,
    ),
  );
  const dialog = document.querySelector<HTMLElement>("[role=dialog]")!;
  Object.defineProperty(dialog, "offsetHeight", { value: 400, configurable: true });
  // A frame for the entrance to land: the sheet sits open, nothing translated.
  await act(async () => new Promise((resolve) => setTimeout(resolve, 60)));
  expect(dialog.style.transform === "" || dialog.style.transform === "none").toBe(true);
  const header = dialog.querySelector<HTMLElement>("h2")!.parentElement!.parentElement!;
  return { closed: () => closes, header };
}

/** One pointer event, as a phone's finger sends it. */
function fire(el: HTMLElement, type: string, y: number, t: number, pointerType = "touch") {
  const e = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: 120, clientY: y });
  Object.defineProperty(e, "pointerId", { value: 7 });
  Object.defineProperty(e, "pointerType", { value: pointerType });
  Object.defineProperty(e, "timeStamp", { value: t });
  el.dispatchEvent(e);
}

/** A finger lands at `from`, moves in steps of `stepMs` to `to`, and lets go (after holding still for `hold` ms). */
async function pull(el: HTMLElement, from: number, to: number, { steps = 10, stepMs = 16, pointerType = "touch", back = 0, hold = 0 } = {}) {
  await act(async () => {
    let t = 1000;
    fire(el, "pointerdown", from, t, pointerType);
    for (let i = 1; i <= steps; i++) fire(el, "pointermove", from + ((to - from) * i) / steps, (t += stepMs), pointerType);
    // Taken back up at the end, when asked.
    for (let i = 1; i <= 4 && back; i++) fire(el, "pointermove", to - (back * i) / 4, (t += stepMs), pointerType);
    const end = back ? to - back : to;
    if (hold) fire(el, "pointermove", end, (t += hold), pointerType);
    fire(el, "pointerup", end, (t += 4), pointerType);
  });
}

describe("the phone's sheet, pulled by its header", () => {
  it("is a sheet on a phone: a grabber at the top, the header takes the drag", async () => {
    const { header } = await openSheet();
    expect(header.className).toContain("touch-none");
    expect(header.querySelector("span[aria-hidden]")).not.toBeNull();
  });

  it("closes on a pull past halfway, even let go without any speed", async () => {
    const { closed, header } = await openSheet();
    await pull(header, 100, 360, { steps: 20, stepMs: 40, hold: 200 });
    expect(closed()).toBe(1);
  });

  it("closes on a short flick", async () => {
    const { closed, header } = await openSheet();
    await pull(header, 100, 180, { steps: 5, stepMs: 12 });
    expect(closed()).toBe(1);
  });

  it("stays open on a short, slow pull", async () => {
    const { closed, header } = await openSheet();
    await pull(header, 100, 160, { steps: 12, stepMs: 60 });
    expect(closed()).toBe(0);
  });

  it("stays open when the finger takes it back before letting go", async () => {
    const { closed, header } = await openSheet();
    await pull(header, 100, 380, { steps: 12, stepMs: 20, back: 120 });
    expect(closed()).toBe(0);
  });

  it("does not move for a mouse: the close button, the scrim and Escape do", async () => {
    const { closed, header } = await openSheet();
    await pull(header, 100, 380, { pointerType: "mouse" });
    expect(closed()).toBe(0);
  });

  it("is the centred dialog above sm, with nothing to pull", async () => {
    phone = false;
    const { closed, header } = await openSheet();
    expect(header.className).not.toContain("touch-none");
    await pull(header, 100, 380);
    expect(closed()).toBe(0);
  });
});
