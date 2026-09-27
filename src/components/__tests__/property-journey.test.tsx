// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import PropertyWizard from "@/components/gestion/PropertyWizard";
import { Field, Input } from "@/components/pro/ui";
import { fr } from "@/lib/i18n/fr";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("motion/react", () => ({
  useReducedMotion: () => true,
  AnimatePresence: ({ children }: { children: React.ReactNode }) => children,
  motion: { div: ({ children, className }: { children: React.ReactNode; className?: string }) => <div className={className}>{children}</div> },
}));
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  HTMLElement.prototype.scrollTo = vi.fn();
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
async function click(text: string) {
  const button = [...document.querySelectorAll("button")].find((b) => b.textContent === text)!;
  expect(button, text).toBeTruthy();
  await act(async () => button.click());
}
async function fill(label: string, value: string) {
  const field = document.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function essentials() {
  await act(async () => document.querySelector<HTMLInputElement>('input[value="house"]')!.click());
  await fill(fr.biens.wizNameLabel, "Maison du Parc");
  await fill(fr.biens.wizStreet, "Rue du Parc");
  await fill(fr.biens.wizCity, "Luxembourg");
  await click(fr.common.next);
}

describe("the three-stage property journey", () => {
  it("requires the essential facts, retains them when editing, then sends the existing API payload", async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: "property-created", units: [] }) });
    vi.stubGlobal("fetch", fetch);
    await act(async () => root.render(<PropertyWizard d={fr} notice="sample" real />));
    expect([...document.querySelectorAll("button")].find(b => b.textContent === fr.common.next)?.disabled).toBe(true);
    await essentials();
    expect(document.querySelector("h1")?.textContent).toBe(fr.experience.propertyExtras);
    expect(fetch).not.toHaveBeenCalled();
    await click(fr.experience.skipExtras);
    expect(document.querySelector("dl")?.textContent).toContain("Maison du Parc");
    await click(fr.experience.editDetails);
    expect(document.querySelector<HTMLInputElement>(`input[aria-label="${fr.biens.wizStreet}"]`)?.value).toBe("Rue du Parc");
    await click(fr.common.next);
    await click(fr.experience.skipExtras);
    await click(fr.biens.wizCreate);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][0]).toBe("/api/biens/create");
    const payload = JSON.parse(fetch.mock.calls[0][1].body);
    expect(payload).toMatchObject({ type: "house", name: "Maison du Parc", street: "Rue du Parc", city: "Luxembourg", country: "LU" });
    expect(document.body.textContent).toContain(fr.biens.wizDoneTitle.replace("{name}", "Maison du Parc"));
  });
  it("allows all optional details to be skipped without a write in a sample cabinet", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await act(async () => root.render(<PropertyWizard d={fr} notice="Nothing saved" />));
    await essentials();
    await click(fr.experience.skipExtras);
    await click(fr.biens.wizCreate);
    expect(fetch).not.toHaveBeenCalled();
    expect(document.querySelector('[role="status"]')?.textContent).toBe("Nothing saved");
  });
  it("keeps floating labels semantic and connects field help", async () => {
    await act(async () => root.render(<Field label="Name" hint="The name on the record"><Input defaultValue="Existing name" /></Field>));
    const input = host.querySelector("input")!;
    expect(input.labels?.[0].textContent).toContain("Name");
    expect(input.value).toBe("Existing name");
    expect(document.getElementById(input.getAttribute("aria-describedby")!)?.textContent).toBe("The name on the record");
  });
});
