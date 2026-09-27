// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SidebarNav from "@/components/gestion/SidebarNav";
import MobileDrawer from "@/components/gestion/MobileDrawer";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement;
let root: Root;
const items = [
  { href: "/app", label: "Accueil", icon: "dashboard" as const },
  { href: "/app/loyers", label: "Finances", icon: "euro" as const, children: [
    { href: "/app/loyers", label: "Loyers" },
    { href: "/app/banque", label: "Banque" },
  ] },
];
function Navigation({ pathname = "/app" }: { pathname?: string }) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({ "/app/loyers": true });
  return <SidebarNav items={items} pathname={pathname} expanded={expanded}
    onToggle={(href) => setExpanded((previous) => ({ ...previous, [href]: !previous[href] }))} />;
}
beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Mobile navigation keyboard contract", () => {
  function Menu() {
    const [open, setOpen] = useState(false);
    return <>
      <button onClick={() => setOpen(true)}>Open menu</button>
      <MobileDrawer open={open} onClose={() => setOpen(false)} label="Menu" closeLabel="Close">
        <Navigation />
        <a href="/app/reglages">Settings</a>
      </MobileDrawer>
    </>;
  }
  beforeEach(() => {
    vi.stubGlobal("matchMedia", vi.fn(() => ({
      matches: false, addListener: vi.fn(), removeListener: vi.fn(),
      addEventListener: vi.fn(), removeEventListener: vi.fn(),
    })));
    // jsdom has no layout. Simulate visible rectangles while keeping hidden
    // disclosure descendants excluded, as they are in a browser.
    vi.spyOn(HTMLElement.prototype, "getClientRects").mockImplementation(function (this: HTMLElement) {
      return (this.closest("[hidden]") ? [] : [{}]) as unknown as DOMRectList;
    });
  });
  it("focuses Close on opening, traps both Tab directions, and excludes collapsed links", async () => {
    await act(async () => root.render(<Menu />));
    await act(async () => host.querySelector("button")!.click());
    const dialog = host.querySelector('[role="dialog"]')!;
    const close = dialog.querySelector<HTMLButtonElement>('button[aria-label="Close"]')!;
    const last = dialog.querySelector<HTMLAnchorElement>('a[href="/app/reglages"]')!;
    expect(document.activeElement).toBe(close);
    expect(document.documentElement.style.overflow).toBe("hidden");
    await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, cancelable: true })));
    expect(document.activeElement).toBe(last);
    await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", cancelable: true })));
    expect(document.activeElement).toBe(close);
    await act(async () => dialog.querySelector<HTMLButtonElement>("button.crm-nav-parent")!.click());
    expect(dialog.querySelector<HTMLElement>(".crm-nav-children")!.hidden).toBe(true);
    await act(async () => last.focus());
    await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", cancelable: true })));
    expect(document.activeElement).toBe(close);
  });
  it("closes with Escape, restores scroll and returns focus to the trigger", async () => {
    await act(async () => root.render(<Menu />));
    const trigger = host.querySelector("button")!;
    await act(async () => { trigger.focus(); trigger.click(); });
    await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(document.activeElement).toBe(trigger);
    expect(document.documentElement.style.overflow).toBe("");
  });
});

describe("Sidebar disclosure navigation", () => {
  it("exposes finance destinations initially and toggles the whole labelled row without navigating", async () => {
    await act(async () => root.render(<Navigation />));
    const button = host.querySelector("button")!;
    const list = document.getElementById(button.getAttribute("aria-controls")!)!;
    expect(button.textContent).toBe("Finances");
    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(list.hidden).toBe(false);
    expect(button.closest("a")).toBeNull();
    await act(async () => button.click());
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(list.hidden).toBe(true);
    await act(async () => button.click());
    expect(list.hidden).toBe(false);
  });
  it("marks only the actual destination as the current page, including nested routes", async () => {
    await act(async () => root.render(<Navigation pathname="/app/banque/retour" />));
    const current = host.querySelectorAll('[aria-current="page"]');
    expect(current).toHaveLength(1);
    expect(current[0].textContent).toBe("Banque");
    expect(host.querySelector("button")!.getAttribute("aria-current")).toBeNull();
  });
  it("gives desktop and mobile instances independent disclosure relationships", async () => {
    await act(async () => root.render(<><Navigation /><Navigation /></>));
    const controls = [...host.querySelectorAll("button")].map((button) => button.getAttribute("aria-controls"));
    expect(new Set(controls).size).toBe(2);
    controls.forEach((id) => expect(document.getElementById(id!)).not.toBeNull());
  });
});
