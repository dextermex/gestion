// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MotionGlobalConfig } from "motion/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import InvestmentWorkspace from "@/components/gestion/investment/InvestmentWorkspace";
import { ApiErrorsProvider } from "@/components/gestion/ApiErrors";
import { fr } from "@/lib/i18n/fr";
import { fr as acquisitions } from "@/lib/i18n/investment-acquisitions";

/**
 * Emprunts and Acquisitions: a book that could not be read says so and
 * offers to try again. It never shows as an empty book, which reads as "you
 * have no loan" to someone whose session ended.
 */
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
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

const render = async () => {
  await act(async () =>
    root.render(
      <ApiErrorsProvider copy={fr.apiErrors}>
        <InvestmentWorkspace locale="fr" properties={[]} section="acquisitions" datasetId="real" />
      </ApiErrorsProvider>,
    ),
  );
  // The two reads and their bodies settle over a few turns.
  for (let i = 0; i < 5; i++) await act(async () => { await Promise.resolve(); });
};
const ok = (records: unknown[]) => new Response(JSON.stringify({ records }), { status: 200 });

describe("the investment books", () => {
  it("say that the load was refused, and why, instead of showing an empty book", async () => {
    for (const [status, error, sentence] of [
      [401, "unauthenticated", fr.apiErrors.session],
      [403, "no_workspace", fr.apiErrors.forbidden],
      [503, "schema_outdated", fr.apiErrors.unavailable],
      [502, "storage_failed", fr.apiErrors.generic],
    ] as const) {
      vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error }), { status })));
      await render();
      const failed = host.querySelector("[data-load-failed]");
      expect(failed, String(status)).not.toBeNull();
      expect(failed!.querySelector("[role=alert]")?.textContent).toContain(sentence);
      expect(host.textContent).not.toContain(acquisitions.emptyTitle);
    }
  });

  it("say so when the connection is cut, and read the books again on request", async () => {
    const fetchMock = vi.fn(async () => Promise.reject(new TypeError("Failed to fetch")));
    vi.stubGlobal("fetch", fetchMock);
    await render();
    expect(host.querySelector("[data-load-failed] [role=alert]")?.textContent).toBe(fr.apiErrors.network);
    vi.stubGlobal("fetch", vi.fn(async () => ok([])));
    const retry = [...host.querySelectorAll("button")].find((b) => b.textContent === fr.apiErrors.retry)!;
    await act(async () => retry.click());
    for (let i = 0; i < 5; i++) await act(async () => { await Promise.resolve(); });
    expect(host.querySelector("[data-load-failed]")).toBeNull();
    // Read and really empty: now the empty book is the truth.
    expect(host.textContent).toContain(acquisitions.emptyTitle);
  });
});
