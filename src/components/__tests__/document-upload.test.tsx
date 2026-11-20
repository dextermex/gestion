// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fr } from "@/lib/i18n/fr";
import { IN_REQUEST_MAX_BYTES, uploadPiece } from "@/lib/gestion/upload-client";

/**
 * Adding a piece to the register: nothing is read by the outside service
 * until the person asks (and never an identity paper or a bank statement);
 * a piece of a tenancy is shared with its tenants only when the box says
 * so; a file larger than a request can carry goes to the bucket itself.
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

type Call = { url: string; method: string; body: unknown; headers: Record<string, string> };

function stubFetch(answer: (url: string, init: RequestInit) => { status: number; body: unknown }): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit = {}) => {
      calls.push({ url, method: init.method ?? "GET", body: init.body, headers: (init.headers as Record<string, string>) ?? {} });
      const { status, body } = answer(url, init);
      return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
    }),
  );
  return calls;
}

const LEASE = "0f0f0f0f-0000-4000-8000-0000000000b1";
const PROPERTY = "0f0f0f0f-0000-4000-8000-0000000000a1";
const classes = [
  { value: "lease", label: fr.documents.clsLease },
  { value: "id_document", label: fr.documents.clsKyc },
  { value: "invoice", label: fr.documents.clsInvoice },
];

async function openDialog(recognition = true) {
  const { default: DocumentUpload } = await import("@/components/gestion/DocumentUpload");
  await act(async () =>
    root.render(
      <DocumentUpload
        classes={classes}
        properties={[{ id: PROPERTY, label: "Maison Weber" }]}
        leases={[{ id: LEASE, label: "Maison · Anna Weber" }]}
        writable
        sampleNote={null}
        labels={{ ...fr.documents, close: fr.common.close }}
        recognition={recognition}
        locale="fr"
      />,
    ),
  );
  const add = Array.from(document.querySelectorAll("button")).find((b) => b.textContent === fr.documents.add)!;
  await act(async () => add.click());
  return document.querySelector("[role=dialog]") as HTMLElement;
}

async function choose(file: File) {
  const input = document.getElementById("document-file") as HTMLInputElement;
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
}

async function select(el: HTMLSelectElement, value: string) {
  await act(async () => {
    el.value = value;
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

const pdf = (name: string, size = 2000) => new File([new Uint8Array(size)], name, { type: "application/pdf" });

describe("the register's upload dialog", () => {
  it("sends nothing to the reader on choice; says where the file would go, and reads only when asked", async () => {
    const calls = stubFetch((url) => (url.includes("analyser") ? { status: 200, body: { configured: true, supported: true, recognition: null } } : { status: 201, body: { id: "d-1" } }));
    const dialog = await openDialog();
    await choose(pdf("bail.pdf"));
    expect(calls).toEqual([]);
    expect(dialog.textContent).toContain(fr.documents.readNotice);
    const read = Array.from(dialog.querySelectorAll("button")).find((b) => b.textContent === fr.documents.readNow)!;
    await act(async () => read.click());
    expect(calls.map((c) => c.url)).toEqual(["/api/documents/analyser"]);
  });

  it("never offers an identity paper to the reader", async () => {
    const calls = stubFetch(() => ({ status: 201, body: { id: "d-1" } }));
    const dialog = await openDialog();
    const [klass] = Array.from(dialog.querySelectorAll("select")) as HTMLSelectElement[];
    await select(klass, "id_document");
    await choose(pdf("passeport.pdf"));
    expect(dialog.textContent).toContain(fr.documents.readNotOffered);
    expect(Array.from(dialog.querySelectorAll("button")).some((b) => b.textContent === fr.documents.readNow)).toBe(false);
    expect(calls).toEqual([]);
  });

  it("offers no reading at all on a deployment without a reader", async () => {
    stubFetch(() => ({ status: 201, body: { id: "d-1" } }));
    const dialog = await openDialog(false);
    await choose(pdf("bail.pdf"));
    expect(dialog.querySelector("[data-read-offer]")).toBeNull();
  });

  it("hangs a piece off a tenancy, shared with its tenants only when the box is ticked", async () => {
    const calls = stubFetch(() => ({ status: 201, body: { id: "d-1" } }));
    const dialog = await openDialog(false);
    await choose(pdf("bail-signe.pdf"));
    const related = (Array.from(dialog.querySelectorAll("select")) as HTMLSelectElement[])[1];
    expect(dialog.querySelector("[data-share-with-tenant]")).toBeNull();
    await select(related, `lease:${LEASE}`);
    const box = dialog.querySelector("[data-share-with-tenant] input") as HTMLInputElement;
    expect(box.checked).toBe(false);
    await act(async () => box.click());
    const save = Array.from(dialog.querySelectorAll("button")).find((b) => b.textContent === fr.documents.save)!;
    await act(async () => save.click());
    const form = calls.find((c) => c.url === "/api/documents")!.body as FormData;
    expect([form.get("relatedType"), form.get("relatedId"), form.get("shared"), form.get("class")]).toEqual(["lease", LEASE, "true", "lease"]);
    expect(refresh).toHaveBeenCalled();
  });

  it("does not share a piece of a property, whatever was ticked before", async () => {
    const calls = stubFetch(() => ({ status: 201, body: { id: "d-1" } }));
    const dialog = await openDialog(false);
    await choose(pdf("acte.pdf"));
    const related = (Array.from(dialog.querySelectorAll("select")) as HTMLSelectElement[])[1];
    await select(related, `lease:${LEASE}`);
    await act(async () => (dialog.querySelector("[data-share-with-tenant] input") as HTMLInputElement).click());
    await select(related, `property:${PROPERTY}`);
    const save = Array.from(dialog.querySelectorAll("button")).find((b) => b.textContent === fr.documents.save)!;
    await act(async () => save.click());
    const form = calls.find((c) => c.url === "/api/documents")!.body as FormData;
    expect([form.get("relatedType"), form.get("relatedId"), form.get("shared")]).toEqual(["property", PROPERTY, null]);
  });
});

describe("uploadPiece", () => {
  it("sends a file a request can carry in the request itself", async () => {
    const calls = stubFetch(() => ({ status: 201, body: { id: "d-1" } }));
    const res = await uploadPiece(pdf("petit.pdf", 1000), { class: "invoice", name: "Facture" }, "/app/documents");
    expect(res).toEqual({ ok: true, status: 201, payload: { id: "d-1" } });
    expect(calls.map((c) => [c.url, c.method])).toEqual([["/api/documents", "POST"]]);
  });

  it("puts a larger file in the bucket with the token the application signed, then registers it by its path", async () => {
    const path = "0f0f0f0f-0000-4000-8000-00000000c0de/documents/11111111-2222-4333-8444-555555555555.pdf";
    const calls = stubFetch((url) =>
      url === "/api/documents/televersement"
        ? { status: 201, body: { bucket: "gestion-media", path, token: "tok" } }
        : url.includes("/storage/v1/")
          ? { status: 200, body: { Key: path } }
          : { status: 201, body: { id: "d-2", name: "Relevé" } },
    );
    const big = pdf("releve-syndic.pdf", IN_REQUEST_MAX_BYTES + 1);
    const res = await uploadPiece(big, { class: "decompte", name: "Relevé" }, "/app/documents");
    expect(res?.ok).toBe(true);
    expect(calls.map((c) => c.method)).toEqual(["POST", "PUT", "POST"]);
    expect(JSON.parse(String(calls[0].body))).toEqual({ type: "application/pdf", size: big.size });
    expect(calls[1].url).toContain(`/storage/v1/object/upload/sign/gestion-media/${path}?token=tok`);
    expect(calls[1].headers["x-upsert"]).toBe("false");
    expect(JSON.parse(String(calls[2].body))).toEqual({ uploadedPath: path, class: "decompte", name: "Relevé" });
  });

  it("says the file was too large when the bucket refuses it, and registers nothing", async () => {
    const calls = stubFetch((url) =>
      url === "/api/documents/televersement" ? { status: 201, body: { bucket: "gestion-media", path: "x/documents/y.pdf", token: "tok" } } : { status: 413, body: {} },
    );
    const res = await uploadPiece(pdf("enorme.pdf", IN_REQUEST_MAX_BYTES + 1), { class: "other" }, "/app/documents");
    expect(res).toEqual({ ok: false, status: 413, payload: { error: "too_large" } });
    expect(calls).toHaveLength(2);
  });
});
