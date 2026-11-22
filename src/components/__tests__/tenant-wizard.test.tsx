// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TenantWizard from "@/components/gestion/TenantWizard";
import { fr } from "@/lib/i18n/fr";

/**
 * The guided rental says what went wrong: a rent that is not an amount is
 * named before anything is sent, a policy the server did not record keeps
 * the wizard on its step, and a session that ended leaves the step as typed.
 */
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("motion/react", () => ({
  useReducedMotion: () => true,
  AnimatePresence: ({ children }: { children: React.ReactNode }) => children,
  motion: { div: ({ children, className }: { children: React.ReactNode; className?: string }) => <div className={className}>{children}</div> },
}));
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

const existing = (startStep: "rent" | "insurance") => ({
  leaseId: "l-draft",
  status: "draft" as const,
  startStep,
  completed: [],
  tenants: [{ contactId: "c-1", firstName: "Ana", lastName: "Santos", email: "", phone: "" }],
  colocation: false,
  type: "residential" as const,
  startDate: "2026-12-01",
  endDate: "",
  rent: startStep === "insurance" ? "1 250,00" : "",
  charges: "",
  paymentDay: "1",
  payerName: "",
  payerIban: "",
  depositMonths: "2",
  depositForm: "cash",
  hasInspection: false,
  hasInsurance: false,
});

const open = async (startStep: "rent" | "insurance") => {
  await act(async () =>
    root.render(
      <TenantWizard d={fr} unitLabel="Studio 4A" propertyName="Studio Quartier Gare" propertyId="p-gare" unitId="u-gare" real notice="" depositMax={{ residential: 2, commercial: 6 }} existing={existing(startStep)} />,
    ),
  );
};
const input = (label: string) =>
  [...document.querySelectorAll<HTMLLabelElement>("label.ui-field-group")].find((l) => l.querySelector(".ui-field-label")?.textContent === label)!.querySelector<HTMLInputElement>("input")!;
const type = async (el: HTMLInputElement, value: string) => {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
};
const next = async () => {
  const button = [...document.querySelectorAll("button")].find((b) => b.textContent === fr.common.next)!;
  await act(async () => button.click());
};
const alerts = () => [...document.querySelectorAll("[role=alert]")].map((a) => a.textContent);
const heading = () => document.querySelector("h1")?.textContent;

describe("the guided rental", () => {
  it("names the rent when it does not read as an amount, and sends nothing", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await open("rent");
    await type(input(fr.location.rent), "1,850");
    await next();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(alerts()).toEqual([`Le champ « ${fr.location.rent} » n'est pas valide.`]);
    expect(heading()).toBe(fr.location.titleRent);
  });

  it("sends no provision as an empty field, never as a zero the route refuses", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ leaseId: "l-draft", contactIds: ["c-1"], completed: ["tenant", "lease", "rent"], issues: [] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await open("rent");
    await type(input(fr.location.rent), "1 250,00");
    await type(input(fr.location.charges), "0");
    await next();
    const sent = JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body)) as Record<string, unknown>;
    expect(sent.rent).toBe("1 250,00");
    expect(sent.charges).toBe("");
    expect(heading()).toBe(fr.location.titlePayer);
  });

  it("stays on the insurance step and says so when the policy is not recorded", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ error: "forbidden" }), { status: 403 }));
    vi.stubGlobal("fetch", fetchMock);
    await open("insurance");
    await type(input(fr.assurances.fieldProvider), "Foyer Assurances");
    await next();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toBe("/api/assurances/create");
    expect(alerts()).toEqual([fr.apiErrors.forbidden]);
    expect(heading()).toBe(fr.location.titleInsurance);
    expect(input(fr.assurances.fieldProvider).value).toBe("Foyer Assurances");
  });

  it("stays on the insurance step when the connection is cut", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("Failed to fetch"))));
    await open("insurance");
    await type(input(fr.assurances.fieldProvider), "Foyer Assurances");
    await next();
    expect(alerts()).toEqual([fr.apiErrors.network]);
    expect(heading()).toBe(fr.location.titleInsurance);
  });

  it("records the policy for the lease, with its expiry as a day, then moves on", async () => {
    const fetchMock = vi.fn(async (url: string) =>
      url === "/api/assurances/create"
        ? new Response(JSON.stringify({ id: "ins-1" }), { status: 200 })
        : new Response(JSON.stringify({ leaseId: "l-draft", contactIds: ["c-1"], completed: [], issues: [] }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await open("insurance");
    await type(input(fr.assurances.fieldProvider), "Foyer Assurances");
    await type(input(fr.assurances.fieldExpires), "31/12/2027");
    await next();
    const sent = JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body)) as Record<string, unknown>;
    expect(sent).toMatchObject({ leaseId: "l-draft", provider: "Foyer Assurances", expiresOn: "2027-12-31" });
    expect(heading()).toBe(fr.location.titleReview);
  });

  it("keeps the step as typed when the session ended, with the way to sign in again beside it", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "unauthenticated" }), { status: 401 })));
    await open("rent");
    await type(input(fr.location.rent), "1 250,00");
    await next();
    const alert = document.querySelector("[role=alert]")!;
    expect(alert.textContent).toContain(fr.apiErrors.sessionKeep);
    const link = alert.querySelector("a")!;
    expect(link.getAttribute("href")).toBe(`/connexion?next=${encodeURIComponent("/app/biens/locataire?bail=l-draft")}`);
    expect(link.getAttribute("target")).toBe("_blank");
    expect(input(fr.location.rent).value).toBe("1 250,00");
    expect(heading()).toBe(fr.location.titleRent);
  });
});
