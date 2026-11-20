// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { fr } from "@/lib/i18n/fr";
import DocumentUpload from "@/components/gestion/DocumentUpload";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
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
  vi.unstubAllGlobals();
});

const button = (text: string) => [...document.querySelectorAll("button")].find((b) => b.textContent === text);

/**
 * The document reader is a further processor: a file goes to it only when
 * the person asks, after reading where it goes. Choosing a file sends
 * nothing.
 */
it("sends a chosen file to the reader only when the person asks for a proposal", async () => {
  const asked: string[] = [];
  const fetchMock = vi.fn(async (url: string) => {
    asked.push(url);
    return { ok: true, status: 200, json: async () => ({ configured: true, supported: true, recognition: null }) };
  });
  vi.stubGlobal("fetch", fetchMock);
  await act(async () =>
    root.render(
      <DocumentUpload classes={[{ value: "other", label: "Autre" }]} properties={[]} writable sampleNote={null} labels={{ ...fr.documents, close: fr.common.close }} recognition locale="fr" />,
    ),
  );
  await act(async () => button(fr.documents.add)!.click());
  const input = document.querySelector<HTMLInputElement>("#document-file")!;
  const file = new File([new Uint8Array([37, 80, 68, 70])], "releve.pdf", { type: "application/pdf" });
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
  expect(fetchMock).not.toHaveBeenCalled();
  expect(document.body.textContent).toContain(fr.documents.readNotice);
  await act(async () => button(fr.documents.readOffer)!.click());
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(asked).toEqual(["/api/documents/analyser"]);
});

it("offers no reading on a deployment without a reader", async () => {
  vi.stubGlobal("fetch", vi.fn());
  await act(async () =>
    root.render(
      <DocumentUpload classes={[{ value: "other", label: "Autre" }]} properties={[]} writable sampleNote={null} labels={{ ...fr.documents, close: fr.common.close }} recognition={false} locale="fr" />,
    ),
  );
  await act(async () => button(fr.documents.add)!.click());
  const input = document.querySelector<HTMLInputElement>("#document-file")!;
  Object.defineProperty(input, "files", { value: [new File(["x"], "a.pdf", { type: "application/pdf" })], configurable: true });
  await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
  expect(button(fr.documents.readOffer)).toBeUndefined();
});
