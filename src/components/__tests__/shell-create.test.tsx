// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fr } from "@/lib/i18n/fr";
import GestionShell, { type ShellData } from "@/components/gestion/Shell";
import { CREATE_EVENT } from "@/components/gestion/HeroCreate";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push }), usePathname: () => "/app", useSearchParams: () => new URLSearchParams() }));
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  // jsdom has no layout: the bar's scroll sentinel observes nothing.
  vi.stubGlobal("IntersectionObserver", class { observe() {} disconnect() {} unobserve() {} });
  localStorage.clear();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

const shell = (over: Partial<ShellData> = {}): ShellData => ({
  datasetId: "real", sampleCabinet: null, signedIn: true, tenant: false, workspaceKind: "owner", orgShortName: "Espace test", userName: "Nadia Kremer", userEmail: "nadia@example.invalid",
  badges: { review: 0, unread: 0 }, unitOptions: [], leaseOptions: [], vacantUnitOptions: [], tenantOptions: [],
  progress: { facts: { property: false, lease: false, bank: false, invite: false }, hrefs: { property: "/app/biens/nouveau", lease: "/app/biens", bank: "/app/banque", invite: "/app/baux" }, tourSeen: false, guide: false }, billing: null, ...over,
});
const open = (kind: string) => act(async () => { window.dispatchEvent(new CustomEvent(CREATE_EVENT, { detail: kind })); });
const blocked = () => document.querySelector("[data-create-blocked]");

describe("a creation sheet whose required list is empty", () => {
  it("says a property comes first and leads to it, for a lease, a payment and an intervention", async () => {
    await act(async () => root.render(<GestionShell locale="fr" dict={fr} shell={shell()}><p>page</p></GestionShell>));
    for (const kind of ["lease", "payment", "ticket"]) {
      await open(kind);
      expect(blocked()?.textContent, kind).toContain(fr.shell.needProperty);
      expect(blocked()?.querySelector("a")?.getAttribute("href"), kind).toBe("/app/biens/nouveau");
      expect(document.querySelector("form.crm-create-form"), kind).toBeNull();
    }
  });

  it("offers the contact sheet when a lease has a lot and nobody to name", async () => {
    await act(async () => root.render(<GestionShell locale="fr" dict={fr} shell={shell({ unitOptions: [{ id: "u-1", label: "Maison · Maison Schmit" }] })}><p>page</p></GestionShell>));
    await open("lease");
    expect(blocked()?.textContent).toContain(fr.shell.needContact);
    await act(async () => blocked()!.querySelector("button")!.click());
    expect(blocked()).toBeNull();
    expect(document.querySelector('form.crm-create-form input[name="name"]')).not.toBeNull();
  });

  it("sends a payment without a running lease to the properties, and leaves a complete sheet alone", async () => {
    const withLot = { unitOptions: [{ id: "u-1", label: "Maison · Maison Schmit" }], vacantUnitOptions: [{ id: "u-1", label: "Maison · Maison Schmit" }], tenantOptions: [{ id: "c-1", label: "Lena Schmit" }] };
    await act(async () => root.render(<GestionShell locale="fr" dict={fr} shell={shell(withLot)}><p>page</p></GestionShell>));
    await open("payment");
    expect(blocked()?.textContent).toContain(fr.shell.needLease);
    expect(blocked()?.querySelector("a")?.getAttribute("href")).toBe("/app/biens");
    await open("lease");
    expect(blocked()).toBeNull();
    expect(document.querySelector('form.crm-create-form select[name="unitId"]')).not.toBeNull();
    // A kind the shell has no sheet for opens nothing.
    await open("contact");
    await open("document");
    expect(document.querySelector('form.crm-create-form input[name="name"]')).not.toBeNull();
  });
});

describe("the rail", () => {
  const aml = () => document.querySelector('a[href="/app/aml"]');

  it("lists AML for a cabinet on a sample cabinet only: an account's own data has nothing behind that screen yet", async () => {
    await act(async () => root.render(<GestionShell locale="fr" dict={fr} shell={shell({ workspaceKind: "manager" })}><p>page</p></GestionShell>));
    expect(aml()).toBeNull();
    expect(document.querySelector('a[href="/app/conformite"]')).not.toBeNull();
    await act(async () => root.render(<GestionShell locale="fr" dict={fr} shell={shell({ workspaceKind: "manager", datasetId: "fr", sampleCabinet: "Cabinet Reuter" })}><p>page</p></GestionShell>));
    expect(aml()).not.toBeNull();
  });
});

describe("the workspace at the head of the rail", () => {
  const two = { workspaceId: "ag-1", workspaces: [{ id: "ag-1", name: "Cabinet Reuter" }, { id: "ag-2", name: "Nadia Kremer" }] };

  it("is a plain name for an account with one workspace", async () => {
    await act(async () => root.render(<GestionShell locale="fr" dict={fr} shell={shell({ workspaceId: "ag-1", workspaces: [two.workspaces[0]] })}><p>page</p></GestionShell>));
    expect(document.querySelector(".crm-workspace-switch")).toBeNull();
    expect(document.querySelector(".crm-workspace")?.textContent).toContain("Espace test");
  });

  it("opens another workspace of the account: the server keeps the choice and the app starts again on its home", async () => {
    const assign = vi.fn();
    vi.stubGlobal("location", { href: "http://localhost/app/biens/p-1", assign });
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await act(async () => root.render(<GestionShell locale="fr" dict={fr} shell={shell(two)}><p>page</p></GestionShell>));
    const toggle = document.querySelector<HTMLButtonElement>("aside .crm-workspace-switch")!;
    expect(toggle.getAttribute("aria-label")).toContain(fr.shell.switchSpace);
    await act(async () => toggle.click());
    const rows = [...document.querySelectorAll<HTMLButtonElement>("aside .crm-workspace-switch + ul button")];
    expect(rows.map((b) => b.querySelector(".truncate")?.textContent)).toEqual(["Cabinet Reuter", "Nadia Kremer"]);
    expect(rows[0].textContent).toContain(fr.access.currentSpace);
    expect(rows[0].getAttribute("aria-current")).toBe("true");
    // The workspace on screen: nothing changes.
    await act(async () => rows[0].click());
    expect(fetchMock).not.toHaveBeenCalled();
    expect(assign).not.toHaveBeenCalled();
    await act(async () => toggle.click());
    await act(async () => document.querySelectorAll<HTMLButtonElement>("aside .crm-workspace-switch + ul button")[1].click());
    expect(fetchMock).toHaveBeenCalledWith("/api/espace/actif", expect.objectContaining({ method: "POST", body: JSON.stringify({ workspaceId: "ag-2" }) }));
    expect(assign).toHaveBeenCalledWith("/app");
  });

  it("says a switch that did not go through, and stays on the workspace on screen", async () => {
    const assign = vi.fn();
    vi.stubGlobal("location", { href: "http://localhost/app", assign });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "not_found" }), { status: 404 })));
    await act(async () => root.render(<GestionShell locale="fr" dict={fr} shell={shell(two)}><p>page</p></GestionShell>));
    await act(async () => document.querySelector<HTMLButtonElement>("aside .crm-workspace-switch")!.click());
    await act(async () => document.querySelectorAll<HTMLButtonElement>("aside .crm-workspace-switch + ul button")[1].click());
    expect(assign).not.toHaveBeenCalled();
    expect(document.querySelector("aside [role=alert]")?.textContent).toBe(fr.access.switchFailed);
  });
});
