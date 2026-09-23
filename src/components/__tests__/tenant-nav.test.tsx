// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TenantBottomNav from "@/components/gestion/TenantBottomNav";
import { fr } from "@/lib/i18n/fr";

/**
 * The tenant space's bottom bar on a phone: four destinations and "Plus",
 * the open one lit, "Plus" lit while a section behind it is open, and the
 * sheet it opens holding the rest: the requests, the owner's space when
 * the account has one, signing out when there is a session.
 */
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let pathname = "/locataire";
vi.mock("next/navigation", () => ({ usePathname: () => pathname }));
vi.mock("@/lib/supabase/browser", () => ({ signOutEverywhere: vi.fn(async () => {}) }));

const t = fr.tenant;
const items = [
  { href: "/locataire", label: t.tabHome, icon: "home" as const },
  { href: "/locataire/bail", label: t.tabLease, icon: "contract" as const },
  { href: "/locataire/paiements", label: t.tabPayments, icon: "euro" as const },
  { href: "/locataire/messages", label: t.tabMessages, icon: "messages" as const },
];
const requests = { href: "/locataire/demandes", label: t.navRequests, icon: "inbox" as const };
const owner = { href: "/app", label: t.moreOwner, icon: "dashboard" as const };

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  window.matchMedia = ((query: string) => ({ matches: false, media: query, onchange: null, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false })) as unknown as typeof window.matchMedia;
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

const render = async (props: Partial<React.ComponentProps<typeof TenantBottomNav>> = {}) => {
  await act(async () => root.render(<TenantBottomNav items={items} more={{ label: t.tabMore, entries: [requests, owner] }} label={t.space} closeLabel={fr.common.close} signOut={t.signOut} {...props} />));
};
const bar = () => document.querySelector(`nav[aria-label="${t.space}"]`)!;
const lit = () => Array.from(bar().querySelectorAll("a, button")).filter((el) => el.getAttribute("aria-current") === "page" || el.className.includes("text-brand-700")).map((el) => el.textContent?.trim());

describe("the tenant's bottom bar", () => {
  it("names the four destinations and Plus, and lights the open one", async () => {
    pathname = "/locataire/paiements";
    await render();
    expect(Array.from(bar().querySelectorAll("a, button")).map((el) => el.textContent?.trim())).toEqual([t.tabHome, t.tabLease, t.tabPayments, t.tabMessages, t.tabMore]);
    expect(lit()).toEqual([t.tabPayments]);
    // Home lights only on the home itself, not on every path under it.
    expect(bar().querySelector('a[href="/locataire"]')?.getAttribute("aria-current")).toBeNull();
  });

  it("lights Plus while a section behind it is open", async () => {
    pathname = "/locataire/demandes/t-1";
    await render();
    expect(lit()).toEqual([t.tabMore]);
  });

  it("opens the rest as a sheet: the requests, the owner's space, signing out", async () => {
    pathname = "/locataire";
    await render();
    expect(document.querySelector("[role=dialog]")).toBeNull();
    await act(async () => (bar().querySelector("button") as HTMLButtonElement).click());
    const sheet = document.querySelector("[role=dialog]")!;
    expect(sheet.getAttribute("aria-label")).toBe(t.tabMore);
    expect(Array.from(sheet.querySelectorAll("a")).map((a) => [a.getAttribute("href"), a.textContent?.trim()])).toEqual([
      ["/locataire/demandes", t.navRequests],
      ["/app", t.moreOwner],
    ]);
    expect(Array.from(sheet.querySelectorAll("button")).map((b) => b.textContent?.trim())).toContain(t.signOut);
  });

  it("offers no sign-out without a session, and no owner's space without one", async () => {
    pathname = "/locataire";
    await render({ signOut: null, more: { label: t.tabMore, entries: [requests] } });
    await act(async () => (bar().querySelector("button") as HTMLButtonElement).click());
    const sheet = document.querySelector("[role=dialog]")!;
    expect(sheet.textContent).not.toContain(t.signOut);
    expect(sheet.textContent).not.toContain(t.moreOwner);
    expect(sheet.textContent).toContain(t.navRequests);
  });
});
