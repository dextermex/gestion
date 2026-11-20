// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { fr } from "@/lib/i18n/fr";
import { en } from "@/lib/i18n/en";
import { de } from "@/lib/i18n/de";
import { lu } from "@/lib/i18n/lu";
import DegradedBanner from "@/components/gestion/DegradedBanner";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  refresh.mockReset();
});

it("says the screen may be incomplete and reads again on request", async () => {
  await act(async () => root.render(<DegradedBanner text={fr.shell.readDegraded} retry={fr.shell.readRetry} />));
  const alert = host.querySelector("[role=alert]");
  expect(alert?.textContent).toContain(fr.shell.readDegraded);
  const button = host.querySelector("button")!;
  expect(button.textContent).toBe(fr.shell.readRetry);
  await act(async () => button.click());
  expect(refresh).toHaveBeenCalledTimes(1);
});

it("is written in all four languages, without em dashes or arrows", () => {
  for (const d of [fr, en, de, lu]) {
    for (const s of [d.shell.readDegraded, d.shell.readRetry]) {
      expect(s.length).toBeGreaterThan(0);
      expect(s).not.toMatch(/[—→]/);
    }
  }
});
