// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TenantBottomNav from "@/components/gestion/TenantBottomNav";
import { fr } from "@/lib/i18n/fr";

/**
 * The tenant space's bottom bar on a phone: the four destinations a tenant
 * uses most (home, payments, requests, messages) and "Plus", the open one
 * lit, "Plus" lit while a section behind it is open, and the sheet it opens
 * holding the rest: the lease, the documents, the profile, the settings,
 * the owner's space when the account has one, signing out when there is a
 * session. Messages carry the unread count; a row behind "Plus" may carry a
 * note, and "Plus" then shows a dot.
 */
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let pathname = "/locataire";
vi.mock("next/navigation", () => ({ usePathname: () => pathname }));
vi.mock("@/lib/supabase/browser", () => ({ signOutEverywhere: vi.fn(async () => {}) }));

const t = fr.tenant;
const items = [
  { href: "/locataire", label: t.tabHome, icon: "home" as const },
  { href: "/locataire/paiements", label: t.tabPayments, icon: "euro" as const },
  { href: "/locataire/demandes", label: t.navRequests, icon: "inbox" as const },
  { href: "/locataire/messages", label: t.tabMessages, icon: "messages" as const },
];
const lease = { href: "/locataire/bail", label: t.navLease, icon: "contract" as const };
const documents = { href: "/locataire/documents", label: t.navDocuments, icon: "documents" as const };
const profile = { href: "/locataire/profil", label: t.navProfile, icon: "user" as const };
const settings = { href: "/locataire/parametres", label: t.navSettings, icon: "settings" as const };
const owner = { href: "/app", label: t.moreOwner, icon: "dashboard" as const };
const rest = [lease, documents, profile, settings];

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
  await act(async () => root.render(<TenantBottomNav items={items} more={{ label: t.tabMore, entries: [...rest, owner] }} label={t.space} closeLabel={fr.common.close} signOut={t.signOut} {...props} />));
};
const bar = () => document.querySelector(`nav[aria-label="${t.space}"]`)!;
const lit = () => Array.from(bar().querySelectorAll("a, button")).filter((el) => el.getAttribute("aria-current") === "page" || el.className.includes("text-brand-700")).map((el) => el.textContent?.trim());

describe("the tenant's bottom bar", () => {
  it("names the four destinations and Plus, and lights the open one", async () => {
    pathname = "/locataire/paiements";
    await render();
    expect(Array.from(bar().querySelectorAll("a, button")).map((el) => el.textContent?.trim())).toEqual([t.tabHome, t.tabPayments, t.navRequests, t.tabMessages, t.tabMore]);
    expect(lit()).toEqual([t.tabPayments]);
    // Home lights only on the home itself, not on every path under it.
    expect(bar().querySelector('a[href="/locataire"]')?.getAttribute("aria-current")).toBeNull();
  });

  it("keeps the requests one tap away, lit on a request's own page", async () => {
    pathname = "/locataire/demandes/t-1";
    await render();
    expect(lit()).toEqual([t.navRequests]);
  });

  it("lights Plus while a section behind it is open", async () => {
    for (const path of ["/locataire/bail", "/locataire/documents", "/locataire/profil", "/locataire/parametres"]) {
      pathname = path;
      await render();
      expect(lit(), path).toEqual([t.tabMore]);
    }
  });

  it("shows the unread count on Messages, capped, with words for a screen reader", async () => {
    pathname = "/locataire";
    const withBadge = (count: number) => items.map((it) => (it.href === "/locataire/messages" ? { ...it, badge: { count, label: `${count} messages non lus` } } : it));
    await render({ items: withBadge(2) });
    const messages = bar().querySelector('a[href="/locataire/messages"]')!;
    expect(messages.querySelector("[aria-label]")?.textContent).toBe("2");
    expect(messages.querySelector("[aria-label]")?.getAttribute("aria-label")).toBe("2 messages non lus");
    await render({ items: withBadge(14) });
    expect(bar().querySelector('a[href="/locataire/messages"] [aria-label]')?.textContent).toBe("9+");
    await render({ items: withBadge(0) });
    expect(bar().querySelector('a[href="/locataire/messages"] [aria-label]')).toBeNull();
  });

  it("puts a dot on Plus and the note on its row when a paper is owed", async () => {
    pathname = "/locataire";
    await render();
    const plus = () => bar().querySelector("button") as HTMLButtonElement;
    expect(plus().querySelector("span[aria-hidden]")).toBeNull();
    await render({ more: { label: t.tabMore, entries: [lease, { ...documents, note: "1 à envoyer" }, profile, settings] } });
    expect(plus().querySelector("span[aria-hidden]")).not.toBeNull();
    await act(async () => plus().click());
    expect(document.querySelector('[role=dialog] a[href="/locataire/documents"]')?.textContent).toContain("1 à envoyer");
  });

  it("opens the rest as a sheet: the lease, the documents, the profile, the settings, the owner's space, signing out", async () => {
    pathname = "/locataire";
    await render();
    expect(document.querySelector("[role=dialog]")).toBeNull();
    await act(async () => (bar().querySelector("button") as HTMLButtonElement).click());
    const sheet = document.querySelector("[role=dialog]")!;
    expect(sheet.getAttribute("aria-label")).toBe(t.tabMore);
    expect(Array.from(sheet.querySelectorAll("a")).map((a) => [a.getAttribute("href"), a.textContent?.trim()])).toEqual([
      ["/locataire/bail", t.navLease],
      ["/locataire/documents", t.navDocuments],
      ["/locataire/profil", t.navProfile],
      ["/locataire/parametres", t.navSettings],
      ["/app", t.moreOwner],
    ]);
    expect(Array.from(sheet.querySelectorAll("button")).map((b) => b.textContent?.trim())).toContain(t.signOut);
  });

  it("offers no sign-out without a session, and no owner's space without one", async () => {
    pathname = "/locataire";
    await render({ signOut: null, more: { label: t.tabMore, entries: rest } });
    await act(async () => (bar().querySelector("button") as HTMLButtonElement).click());
    const sheet = document.querySelector("[role=dialog]")!;
    expect(sheet.textContent).not.toContain(t.signOut);
    expect(sheet.textContent).not.toContain(t.moreOwner);
    expect(sheet.textContent).toContain(t.navLease);
  });
});
