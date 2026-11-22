// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fr } from "@/lib/i18n/fr";
import { generateLabels } from "@/lib/documents/labels";

/**
 * The control that produces a document and mails it: it says what the
 * outbox really holds, does not mail a piece twice by a second click, and
 * leads to Réglages when that is where a refusal is settled.
 */
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
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

function stubFetch(answers: Array<{ status: number; body: unknown }>) {
  const bodies: unknown[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: RequestInit = {}) => {
      bodies.push(init.body ? JSON.parse(String(init.body)) : undefined);
      const { status, body } = answers.shift() ?? { status: 500, body: {} };
      return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
    }),
  );
  return bodies;
}

async function mount(existing: boolean) {
  const { default: GenerateDocument } = await import("@/components/gestion/GenerateDocument");
  await act(async () =>
    root.render(
      <GenerateDocument
        kind="rent_notice"
        sourceId="rp-1"
        label="Avis d'échéance"
        existing={existing ? { documentId: "d-1", name: "Avis.pdf", producedLabel: "" } : null}
        writable
        sampleNote={null}
        labels={generateLabels(fr)}
        backTo="/app/loyers"
      />,
    ),
  );
}

const button = (text: string) => Array.from(host.querySelectorAll("button")).find((b) => b.textContent === text) as HTMLButtonElement | undefined;

describe("GenerateDocument", () => {
  it("says an address was recorded only when the outbox holds its line", async () => {
    stubFetch([{ status: 201, body: { deliveries: [{ email: "anna@example.lu", status: "not_configured", id: null }, { email: "luc@example.lu", status: "not_configured", id: "dl-2" }] } }]);
    await mount(true);
    await act(async () => button(fr.documents.send)!.click());
    expect(host.querySelector("[role=alert]")?.textContent).toBe(fr.documents.sendNotRecorded.replace("{email}", "anna@example.lu"));
    expect(host.querySelector("[role=status]")?.textContent).toBe(fr.documents.sendRecorded.replace("{email}", "luc@example.lu"));
  });

  it("does not mail a piece twice by a second click: says when it went, then sends again only on purpose", async () => {
    const bodies = stubFetch([
      { status: 409, body: { error: "already_sent", emails: ["anna@example.lu"], sentOn: "18/11/2026" } },
      { status: 201, body: { deliveries: [{ email: "anna@example.lu", status: "sent", id: "dl-3" }] } },
    ]);
    await mount(true);
    await act(async () => button(fr.documents.send)!.click());
    expect(host.querySelector("[role=status]")?.textContent).toBe(fr.documents.sendAlready.replace("{email}", "anna@example.lu").replace("{date}", "18/11/2026"));
    await act(async () => button(fr.documents.sendAgain)!.click());
    expect(bodies).toEqual([{ again: false }, { again: true }]);
    expect(host.querySelector("[role=status]")?.textContent).toBe(fr.documents.sentTo.replace("{email}", "anna@example.lu"));
    expect(button(fr.documents.send)).toBeDefined();
  });

  it("leads to Réglages when the template is still to validate", async () => {
    stubFetch([{ status: 409, body: { error: "template_not_validated" } }]);
    await mount(false);
    await act(async () => button(`Avis d'échéance · ${fr.documents.produce}`)!.click());
    expect(host.querySelector("[role=alert]")?.textContent).toBe(fr.documents.errTemplate);
    const link = Array.from(host.querySelectorAll("a")).find((a) => a.textContent === fr.documents.openSettings);
    expect(link?.getAttribute("href")).toBe("/app/reglages");
  });
});
