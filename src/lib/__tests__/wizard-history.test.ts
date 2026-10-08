// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createElement, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stepParser, useStepHistory } from "@/lib/wizard-history";

/**
 * A wizard step is a history entry: moving on pushes one, the back gesture
 * pops it and the wizard follows, a reload lands on the step in the address.
 */
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
let api: { step: number; set: (n: number) => void; back: (fallback: () => void) => void };

function Harness() {
  const [step, setStep] = useState(0);
  const { back } = useStepHistory(step, setStep, stepParser(0, 5));
  api = { step, set: setStep, back };
  return createElement("p", null, String(step));
}

beforeEach(async () => {
  window.history.replaceState(null, "", "/app/biens/etat-des-lieux?bail=l-1&type=exit");
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root.render(createElement(Harness)));
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

describe("one history entry per wizard step", () => {
  it("writes the first step into the address without a new entry, then pushes one per step", async () => {
    expect(new URL(window.location.href).searchParams.get("etape")).toBe("0");
    const push = vi.spyOn(window.history, "pushState");
    await act(async () => api.set(1));
    await act(async () => api.set(2));
    expect(push).toHaveBeenCalledTimes(2);
    expect(new URL(window.location.href).searchParams.get("etape")).toBe("2");
    expect(new URL(window.location.href).searchParams.get("bail")).toBe("l-1");
  });

  it("follows the back gesture to the step in the address", async () => {
    await act(async () => api.set(3));
    window.history.replaceState(null, "", "/app/biens/etat-des-lieux?bail=l-1&type=exit&etape=2");
    await act(async () => {
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(host.textContent).toBe("2");
    // Nothing is pushed back for a step the gesture restored.
    expect(new URL(window.location.href).searchParams.get("etape")).toBe("2");
  });

  it("pops an entry of its own and otherwise leaves the move to the wizard", async () => {
    const back = vi.spyOn(window.history, "back").mockImplementation(() => {});
    const fallback = vi.fn();
    api.back(fallback);
    expect(fallback).toHaveBeenCalledTimes(1);
    expect(back).not.toHaveBeenCalled();
    await act(async () => api.set(1));
    api.back(fallback);
    expect(back).toHaveBeenCalledTimes(1);
    expect(fallback).toHaveBeenCalledTimes(1);
  });

  it("reads only whole steps within range from the address", () => {
    const parse = stepParser(0, 4);
    expect(parse("3")).toBe(3);
    expect(parse("4")).toBe(4);
    expect(parse("5")).toBeNull();
    expect(parse("-1")).toBeNull();
    expect(parse("2.5")).toBeNull();
    expect(parse("abc")).toBeNull();
    expect(parse(null)).toBeNull();
  });
});
