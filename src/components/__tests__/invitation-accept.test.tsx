// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { fr } from "@/lib/i18n/fr";
import InvitationAccept, { type InvitePreviewView } from "@/components/gestion/InvitationAccept";

vi.mock("@/lib/supabase/browser", () => ({ signOutEverywhere: vi.fn(async () => undefined) }));
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

const TOKEN = "Qx3aZ09kQx3aZ09kQx3aZ09kQx3aZ09kQx3aZ09k";
const preview: InvitePreviewView = {
  state: "pending", mine: false, firstName: "Anna", email: "anna@example.test", orgName: "Cabinet Test", home: "Apt 3B · Résidence", address: "", expiresOn: "",
};

it("sends the way back through sign-up and sign-in to the invitation page, never with its token", async () => {
  await act(async () => root.render(<InvitationAccept token={TOKEN} t={fr.tenant.invite} backLabel="Retour" preview={preview} session={null} />));
  const links = [...host.querySelectorAll("a")].map((a) => a.getAttribute("href") ?? "").filter((h) => h.startsWith("/inscription") || h.startsWith("/connexion"));
  expect(links).toHaveLength(2);
  for (const href of links) {
    expect(href).not.toContain(TOKEN);
    expect(new URL(href, "https://app.morada.lu").searchParams.get("next")).toBe("/invitation");
  }
  expect(host.innerHTML).not.toContain(TOKEN);
});
