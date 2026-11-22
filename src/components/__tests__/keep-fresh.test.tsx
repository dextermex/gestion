// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import KeepFresh, { FRESH_FOR_MS } from "@/components/KeepFresh";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLDivElement;
let visibility: DocumentVisibilityState = "visible";
beforeEach(async () => {
  vi.useFakeTimers();
  refresh.mockClear();
  visibility = "visible";
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibility });
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root.render(<KeepFresh />));
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
});

it("reads the screen again before an hour-long file link runs out, and not before", async () => {
  expect(FRESH_FOR_MS).toBeLessThan(60 * 60_000);
  await act(async () => vi.advanceTimersByTime(FRESH_FOR_MS - 61_000));
  expect(refresh).not.toHaveBeenCalled();
  await act(async () => vi.advanceTimersByTime(2 * 60_000));
  expect(refresh).toHaveBeenCalledTimes(1);
  // Read once: the next re-read waits for the same stretch again.
  await act(async () => vi.advanceTimersByTime(10 * 60_000));
  expect(refresh).toHaveBeenCalledTimes(1);
});

it("waits for a tab in the background to come back, then reads at once", async () => {
  visibility = "hidden";
  await act(async () => vi.advanceTimersByTime(3 * 60 * 60_000));
  expect(refresh).not.toHaveBeenCalled();
  visibility = "visible";
  await act(async () => document.dispatchEvent(new Event("visibilitychange")));
  expect(refresh).toHaveBeenCalledTimes(1);
});
