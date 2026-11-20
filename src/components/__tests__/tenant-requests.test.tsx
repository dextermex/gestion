// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fr } from "@/lib/i18n/fr";
import { requestLabels } from "@/lib/portal/labels";

/**
 * A new request from the tenant's space: with two tenancies in force it
 * asks which one it is about; a file that did not go after the request was
 * written is named, and the form stays to say so instead of moving on.
 */
const push = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh }) }));
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  push.mockReset();
  refresh.mockReset();
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

const t = fr.tenant;
const TWO = [
  { id: "l-home", label: "Apt 3B · Résidence Beaulieu" },
  { id: "l-parking", label: "Parking 12 · Résidence Beaulieu" },
];

async function open(tenancies: Array<{ id: string; label: string }>) {
  const { default: TenantRequests } = await import("@/components/gestion/TenantRequests");
  await act(async () => root.render(<TenantRequests labels={requestLabels(fr)} canCreate sampleNote={null} tenancies={tenancies} />));
  await act(async () => Array.from(document.querySelectorAll("button")).find((b) => b.textContent === t.reqNew)!.click());
  // A question: no category to choose, a title is enough.
  await act(async () => Array.from(document.querySelectorAll<HTMLButtonElement>("[role=dialog] button")).find((b) => b.textContent?.includes(t.kindQuestion))!.click());
  const dialog = document.querySelector("[role=dialog]") as HTMLElement;
  const title = dialog.querySelector("form input:not([type=file])") as HTMLInputElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(title, "Le portail du parking");
    title.dispatchEvent(new Event("input", { bubbles: true }));
  });
  return dialog;
}

function stub(answers: Record<string, Array<{ status: number; body: unknown }>>) {
  const sent: Array<{ url: string; body: unknown }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit = {}) => {
      sent.push({ url, body: typeof init.body === "string" ? JSON.parse(init.body) : init.body });
      const key = Object.keys(answers).find((k) => url.includes(k)) ?? "";
      const { status, body } = answers[key]?.shift() ?? { status: 500, body: {} };
      return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
    }),
  );
  return sent;
}

describe("a tenant's new request", () => {
  it("asks which tenancy it is about when two are in force, and sends that one", async () => {
    const sent = stub({ "/api/locataire/demandes": [{ status: 200, body: { ok: true, id: "t-1" } }] });
    const dialog = await open(TWO);
    const pick = dialog.querySelector("select[data-request-tenancy]") as HTMLSelectElement;
    expect(Array.from(pick.options).map((o) => o.textContent)).toEqual(TWO.map((x) => x.label));
    await act(async () => {
      pick.value = "l-parking";
      pick.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await act(async () => (dialog.querySelector("form button[type=submit]") as HTMLButtonElement).click());
    expect((sent[0].body as { leaseId?: string }).leaseId).toBe("l-parking");
    expect(push).toHaveBeenCalledWith("/locataire/demandes/t-1");
  });

  it("asks nothing with one tenancy", async () => {
    stub({});
    const dialog = await open(TWO.slice(0, 1));
    expect(dialog.querySelector("select[data-request-tenancy]")).toBeNull();
  });

  it("names the files that did not go once the request is written, and stays to say so", async () => {
    stub({
      "/pieces": [
        { status: 200, body: { ok: true, attached: 1 } },
        { status: 502, body: { error: "upload_failed" } },
      ],
      "/api/locataire/demandes": [{ status: 200, body: { ok: true, id: "t-2" } }],
    });
    const dialog = await open(TWO.slice(0, 1));
    const input = dialog.querySelector("input[type=file]") as HTMLInputElement;
    const files = [new File([new Uint8Array(10)], "portail.png", { type: "image/png" }), new File([new Uint8Array(10)], "plan.pdf", { type: "application/pdf" })];
    Object.defineProperty(input, "files", { value: files, configurable: true });
    await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
    await act(async () => new Promise((r) => setTimeout(r, 0)));
    await act(async () => (dialog.querySelector("form button[type=submit]") as HTMLButtonElement).click());
    const partial = document.querySelector("[data-request-partial]");
    expect(partial?.textContent).toContain(t.reqSentFilesFailed.replace("{failed}", "1"));
    expect(partial?.textContent).toContain(t.fileNotSent.replace("{name}", "plan.pdf"));
    expect(push).not.toHaveBeenCalled();
    await act(async () => Array.from(partial!.querySelectorAll("button")).find((b) => b.textContent === t.reqSeeIt)!.click());
    expect(push).toHaveBeenCalledWith("/locataire/demandes/t-2");
  });
});
