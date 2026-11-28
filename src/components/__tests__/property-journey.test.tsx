// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import PropertyWizard from "@/components/gestion/PropertyWizard";
import { Field, Input } from "@/components/pro/ui";
import { fr } from "@/lib/i18n/fr";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
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
  it("never creates the property twice when the connection is cut while its photographs go up", async () => {
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: () => "blob:photo", revokeObjectURL: () => {} }));
    const fetch = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ id: "property-created", units: [] }) })
      .mockRejectedValueOnce(new TypeError("Failed to fetch"));
    vi.stubGlobal("fetch", fetch);
    await act(async () => root.render(<PropertyWizard d={fr} notice="sample" real />));
    await essentials();
    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(input, "files", { value: [new File(["photo"], "facade.jpg", { type: "image/jpeg" })] });
    await act(async () => {
      input.dispatchEvent(new Event("change", { bubbles: true }));
      await Promise.resolve();
    });
    await click(fr.experience.skipExtras);
    await click(fr.biens.wizCreate);
    // The property is created once, the photograph was attempted once, and the wizard is past "Créer".
    expect(fetch.mock.calls.map((c) => c[0])).toEqual(["/api/biens/create", "/api/biens/photo"]);
    expect(document.body.textContent).toContain(fr.biens.wizDoneTitle.replace("{name}", "Maison du Parc"));
    expect(document.querySelector('[role="alert"]')?.textContent).toBe(fr.biens.wizPhotoFailed);
    expect([...document.querySelectorAll("button")].some((b) => b.textContent === fr.biens.wizCreate)).toBe(false);
  });
  it("says in words why a creation is refused, and keeps the wizard on its review", async () => {
    const refusals: Array<[number, string, string, string]> = [
      [503, "schema_outdated", "parking", fr.biens.wizParkingUnavailable],
      [402, "subscription_required", "house", fr.apiErrors.subscription],
      [403, "forbidden", "house", fr.apiErrors.forbidden],
      [502, "storage_failed", "house", fr.biens.wizSaveFailed],
    ];
    for (const [status, error, type, sentence] of refusals) {
      vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error }), { status })));
      await act(async () => root.render(<PropertyWizard key={`${status}-${type}`} d={fr} notice="sample" real />));
      await act(async () => document.querySelector<HTMLInputElement>(`input[value="${type}"]`)!.click());
      await fill(fr.biens.wizNameLabel, "Maison du Parc");
      await fill(fr.biens.wizStreet, "Rue du Parc");
      await fill(fr.biens.wizCity, "Luxembourg");
      await click(fr.common.next);
      await click(fr.experience.skipExtras);
      await click(fr.biens.wizCreate);
      expect(document.querySelector('[role="alert"]')?.textContent, `${status} ${error}`).toBe(sentence);
      expect([...document.querySelectorAll("button")].some((b) => b.textContent === fr.biens.wizCreate)).toBe(true);
    }
  });
  it("sends only the photograph chosen as cover: a property has one, and each upload would replace the last", async () => {
    const fetch = vi.fn(async (url: string) => ({ ok: true, json: async () => (url === "/api/biens/create" ? { id: "property-created", units: [] } : { path: "x" }) }));
    vi.stubGlobal("fetch", fetch);
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: () => "blob:photo", revokeObjectURL: () => undefined }));
    await act(async () => root.render(<PropertyWizard d={fr} notice="sample" real />));
    await essentials();
    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    const files = [new File([new Uint8Array(10)], "facade.jpg", { type: "image/jpeg" }), new File([new Uint8Array(20)], "jardin.jpg", { type: "image/jpeg" })];
    Object.defineProperty(input, "files", { value: files, configurable: true });
    await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
    await act(async () => new Promise((r) => setTimeout(r, 0)));
    await click(fr.biens.wizSetCover);
    await click(fr.experience.skipExtras);
    await click(fr.biens.wizCreate);
    const uploads = fetch.mock.calls.filter(([url]) => url === "/api/biens/photo");
    expect(uploads).toHaveLength(1);
    expect(((uploads[0] as unknown as [string, { body: FormData }])[1].body.get("file") as File).name).toBe("jardin.jpg");
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
