// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { fr } from "@/lib/i18n/fr";
import * as cabinet from "@/lib/demo/data";

/**
 * "Traiter la file" on the banking screen. The review queue shows under
 * two of the four filters; the link must reach it from the other two as
 * well, whether the filter came from the address (`?vue=auto`) or from a
 * click on the screen since.
 */
vi.mock("@/lib/demo", () => ({ getDemo: async () => cabinet, getDatasetId: async () => "fr", isSampleData: async () => true }));
vi.mock("@/lib/i18n", () => ({ getI18n: async () => ({ locale: "fr", d: fr }) }));
vi.mock("@/lib/supabase/server", () => ({ getSession: async () => null }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("next/link", () => ({
  default: ({ href, children, onClick, ...rest }: { href: string; children: React.ReactNode; onClick?: (e: React.MouseEvent) => void }) => (
    <a href={href} {...rest} onClick={(e) => { e.preventDefault(); onClick?.(e); }}>{children}</a>
  ),
}));
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLDivElement;
const scrolled = vi.fn();
beforeEach(() => {
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  Element.prototype.scrollIntoView = scrolled;
  scrolled.mockClear();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

const open = async (params: Record<string, string>) => {
  const { default: Page } = await import("@/app/app/banque/page");
  const tree = await Page({ searchParams: Promise.resolve(params) });
  await act(async () => root.render(tree));
};
const link = () => [...host.querySelectorAll("a")].find((a) => a.textContent?.includes(fr.banque.kpiReviewAction))!;

it("names the view that has the queue when the page opened on one that does not, and puts the queue on screen", async () => {
  await open({ vue: "auto" });
  expect(host.querySelector("#a-verifier")).toBeNull();
  expect(link().getAttribute("href")).toBe("/app/banque?vue=review#a-verifier");
  await act(async () => link().click());
  expect(host.querySelector("#a-verifier")).not.toBeNull();
  expect(scrolled).toHaveBeenCalled();
});

it("still reaches the queue after the filter was changed on the screen", async () => {
  await open({});
  expect(link().getAttribute("href")).toBe("#a-verifier");
  expect(host.querySelector("#a-verifier")).not.toBeNull();
  const ignored = [...host.querySelectorAll("button")].find((b) => b.textContent?.startsWith(fr.banque.viewIgnored))!;
  await act(async () => ignored.click());
  expect(host.querySelector("#a-verifier")).toBeNull();
  await act(async () => link().click());
  expect(host.querySelector("#a-verifier")).not.toBeNull();
});
