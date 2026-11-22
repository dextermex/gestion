// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MotionGlobalConfig } from "motion/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CreateDialog } from "@/components/gestion/Shell";
import { fr } from "@/lib/i18n/fr";

/**
 * The quick "Bail" sheet: nothing is chosen for the owner, only a lot that
 * can be let and a recorded tenant are offered, a refusal is said in words
 * and what the rule engine raised on the new lease is shown, not dropped.
 */
const push = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh }), usePathname: () => "/app" }));
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
const onClose = vi.fn();

const vacant = [{ id: "u-free", label: "Studio 4A · Studio Quartier Gare" }];
const tenants = [{ id: "c-tenant", label: "Ana Santos" }];

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  MotionGlobalConfig.skipAnimations = true;
  window.matchMedia = ((query: string) => ({ matches: false, media: query, onchange: null, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false })) as unknown as typeof window.matchMedia;
  onClose.mockReset();
  push.mockReset();
  refresh.mockReset();
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  MotionGlobalConfig.skipAnimations = false;
  vi.unstubAllGlobals();
});

const open = async (units = vacant, people = tenants) => {
  await act(async () =>
    root.render(
      <CreateDialog kind="lease" onClose={onClose} onCreate={() => {}} d={fr} real unitOptions={[{ id: "u-let", label: "Apt 3B · Résidence Beaulieu" }, ...units]} leaseOptions={[]} vacantUnitOptions={units} tenantOptions={people} />,
    ),
  );
};
const form = () => document.querySelector<HTMLFormElement>("form.crm-create-form")!;
const field = <T extends HTMLElement>(name: string) => form().querySelector<T>(`[name="${name}"]`)!;
const setValue = async (el: HTMLInputElement | HTMLSelectElement, value: string) => {
  const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value);
    el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
  });
};
const submit = async () => {
  await act(async () => form().dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
};
/** Fill both steps and send. */
const fillAndSend = async (rent = "1 250,00") => {
  await setValue(field<HTMLSelectElement>("unitId"), "u-free");
  await setValue(field<HTMLSelectElement>("tenantContactId"), "c-tenant");
  await submit();
  await setValue(field<HTMLInputElement>("rent"), rent);
  await submit();
};

describe("the quick lease sheet", () => {
  it("offers the vacant lots and the tenants, and selects nothing for the owner", async () => {
    await open();
    const unit = field<HTMLSelectElement>("unitId");
    expect([...unit.options].map((o) => o.textContent)).toEqual([fr.shell.pickUnit, "Studio 4A · Studio Quartier Gare"]);
    expect(unit.value).toBe("");
    expect(unit.required).toBe(true);
    const tenant = field<HTMLSelectElement>("tenantContactId");
    expect([...tenant.options].map((o) => o.textContent)).toEqual([fr.shell.pickTenant, "Ana Santos"]);
    expect(tenant.value).toBe("");
    expect(tenant.required).toBe(true);
  });

  it("says why when there is no vacant lot to choose", async () => {
    await open([]);
    expect(form().textContent).toContain(fr.shell.noVacantUnit);
  });

  it("says that a tenant must be recorded first, and offers to add one, when there is none", async () => {
    await open(vacant, []);
    expect(document.querySelector("form.crm-create-form")).toBeNull();
    const blocked = document.querySelector("[data-create-blocked]");
    expect(blocked?.textContent).toContain(fr.shell.needContact);
    expect(blocked?.textContent).toContain(fr.shell.needContactAction);
  });

  it("names the field when the rent does not read as an amount, and sends nothing", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await open();
    await fillAndSend("1,850");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(form().querySelector("[role=alert]")?.textContent).toBe(`Le champ « ${fr.shell.fieldRent} » n'est pas valide.`);
  });

  it("keeps what the rule engine raised on the lease it recorded", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: "l-new", status: "active", issues: [{ code: "DEPOSIT_OVER_CAP", message: "La garantie de 3 mois dépasse le plafond légal de 2 mois pour ce type de bail." }] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await open();
    await fillAndSend();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const sent = JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body)) as Record<string, unknown>;
    expect(sent.unitId).toBe("u-free");
    expect(sent.tenantContactId).toBe("c-tenant");
    expect(sent.startDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // The sheet stays, with the lease recorded and the point to settle.
    expect(onClose).not.toHaveBeenCalled();
    const done = document.querySelector("[data-lease-created]")!;
    expect(done.getAttribute("data-lease-created")).toBe("l-new");
    expect(done.textContent).toContain(fr.shell.leaseCreated);
    expect(done.textContent).toContain("dépasse le plafond légal de 2 mois");
    expect(refresh).toHaveBeenCalled();
  });

  it("closes on a lease recorded with nothing to say", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ id: "l-new", status: "active", issues: [] }), { status: 200 })));
    await open();
    await fillAndSend();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("says that the lot is already let when the server refuses it, and keeps the sheet as typed", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "already_let" }), { status: 409 })));
    await open();
    await fillAndSend();
    expect(onClose).not.toHaveBeenCalled();
    expect(form().textContent).toContain(fr.apiErrors.conflicts.already_let);
    expect(field<HTMLInputElement>("rent").value).toBe("1 250,00");
  });

  it("offers to sign in again beside the sheet when the session ended", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "unauthenticated" }), { status: 401 })));
    await open();
    await fillAndSend();
    const alert = [...form().querySelectorAll("[role=alert]")].find((a) => a.textContent?.includes(fr.apiErrors.sessionKeep))!;
    const link = alert.querySelector("a")!;
    expect(link.getAttribute("href")).toMatch(/^\/connexion\?next=/);
    expect(link.getAttribute("target")).toBe("_blank");
    expect(field<HTMLInputElement>("rent").value).toBe("1 250,00");
  });
});
