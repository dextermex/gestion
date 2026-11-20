// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { fr } from "@/lib/i18n/fr";
import InvitePanel from "@/components/gestion/InvitePanel";
import { inviteLabels, type PartyInvitation } from "@/lib/portal/owner";
import { inviteStateMeta } from "@/lib/types";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  refresh.mockReset();
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

const linked: PartyInvitation = { contactId: "5c1d2e3f-0a1b-4c2d-8e3f-4a5b6c7d8e9f", name: "Jean Muller", email: "jean@example.lu", state: "accepted", inviteId: "inv-1", detail: "", linked: true, canInvite: false };
const button = (text: string) => [...host.querySelectorAll("button")].find((b) => b.textContent === text);

it("withdraws a tenant's access after a confirmation, and reads the new state back", async () => {
  const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) }));
  vi.stubGlobal("fetch", fetchMock);
  await act(async () => root.render(<InvitePanel leaseId="l-1" sample={false} parties={[linked]} labels={inviteLabels(fr)} stateMeta={inviteStateMeta(fr)} />));
  await act(async () => button(fr.baux.portalWithdraw)!.click());
  expect(host.textContent).toContain(fr.baux.portalWithdrawConfirm);
  expect(fetchMock).not.toHaveBeenCalled();
  await act(async () => button(fr.common.yes)!.click());
  expect(fetchMock).toHaveBeenCalledWith(`/api/contacts/${linked.contactId}/acces`, { method: "DELETE" });
  expect(refresh).toHaveBeenCalledTimes(1);
});

it("says so when the access could not be withdrawn", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 502, json: async () => ({ error: "storage_failed" }) })));
  await act(async () => root.render(<InvitePanel leaseId="l-1" sample={false} parties={[linked]} labels={inviteLabels(fr)} stateMeta={inviteStateMeta(fr)} />));
  await act(async () => button(fr.baux.portalWithdraw)!.click());
  await act(async () => button(fr.common.yes)!.click());
  expect(host.querySelector("[role=alert]")?.textContent).toBe(fr.baux.portalWithdrawFailed);
  expect(refresh).not.toHaveBeenCalled();
});

it("offers nothing to withdraw on a sample cabinet", async () => {
  await act(async () => root.render(<InvitePanel leaseId="l-1" sample parties={[linked]} labels={inviteLabels(fr)} stateMeta={inviteStateMeta(fr)} />));
  expect(button(fr.baux.portalWithdraw)).toBeUndefined();
});
