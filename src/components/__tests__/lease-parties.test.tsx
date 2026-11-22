// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import LeaseParties, { type PartiesLabels, type PartyRow } from "@/components/gestion/LeaseParties";
import { fr } from "@/lib/i18n/fr";

/**
 * The people on a tenancy, on its sheet: a co-tenant is dated out, the last
 * tenant's refusal is said in words, a person's access to the space is taken
 * back, and someone joins. The sample cabinet offers none of it.
 */
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh }) }));
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
const b = fr.baux;
const labels: PartiesLabels = {
  linked: b.partyLinked, moveOut: b.partyMoveOut, moveOutOn: b.partyMoveOutOn, moveOutDo: b.partyMoveOutDo, keep: b.partyKeep, lastTenant: b.partyLastTenant,
  failed: b.partyFailed, access: b.partyAccess, accessBody: b.partyAccessBody, accessDo: b.partyAccessDo, add: b.partyAdd, addContact: b.partyAddContact,
  addRole: b.partyAddRole, roleTenant: b.partyTenant, roleGuarantor: b.partyGuarantor, addOn: b.partyAddOn, addDo: b.partyAddDo, pick: b.partyPick,
  already: b.partyAlready, invalid: b.partyInvalid, noCandidate: b.partyNoCandidate,
};
const row = (over: Partial<PartyRow> = {}): PartyRow => ({
  id: "lp-1", contactId: "c-1", name: "Anna Weber", href: "/app/contacts/c-1", email: null, phone: null, roleLabel: b.partyTenant,
  datesLabel: "Depuis le 1 mars 2026", present: true, portalLinked: true, ...over,
});

function render(rows: PartyRow[], writable = true) {
  act(() => {
    root.render(<LeaseParties leaseId="l-1" rows={rows} candidates={[{ id: "c-9", label: "Nora Adam" }]} labels={labels} writable={writable} live today="2026-11-20" />);
  });
}
const button = (name: string) => [...host.querySelectorAll("button")].find((x) => x.textContent?.trim() === name);

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  refresh.mockReset();
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

describe("the parties of a tenancy on its sheet", () => {
  it("says why the last tenant cannot be dated out from here", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ error: "last_tenant" }), { status: 409 }));
    vi.stubGlobal("fetch", fetchMock);
    render([row()]);
    act(() => button(b.partyMoveOut)!.click());
    await act(async () => button(b.partyMoveOutDo)!.click());
    expect(fetchMock).toHaveBeenCalledWith("/api/baux/l-1/parties/lp-1", expect.objectContaining({ method: "PATCH", body: JSON.stringify({ movedOutOn: "2026-11-20" }) }));
    expect(host.querySelector('[role="alert"]')?.textContent).toBe(b.partyLastTenant);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("takes access back and adds a person", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    render([row()]);
    act(() => button(b.partyAccess)!.click());
    expect(host.textContent).toContain(b.partyAccessBody);
    await act(async () => button(b.partyAccessDo)!.click());
    expect(fetchMock).toHaveBeenCalledWith("/api/portail/acces/c-1", expect.objectContaining({ method: "DELETE" }));
    expect(refresh).toHaveBeenCalledTimes(1);

    act(() => button(b.partyAdd)!.click());
    const select = host.querySelector("[data-party-add] select") as HTMLSelectElement;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!;
      setter.call(select, "c-9");
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await act(async () => button(b.partyAddDo)!.click());
    expect(fetchMock).toHaveBeenLastCalledWith("/api/baux/l-1/parties", expect.objectContaining({ method: "POST", body: JSON.stringify({ contactId: "c-9", role: "tenant", movedInOn: "2026-11-20" }) }));
  });

  it("offers nothing to change on the sample cabinet", () => {
    render([row()], false);
    expect(button(b.partyMoveOut)).toBeUndefined();
    expect(button(b.partyAccess)).toBeUndefined();
    expect(button(b.partyAdd)).toBeUndefined();
    expect(host.textContent).toContain("Anna Weber");
  });
});
