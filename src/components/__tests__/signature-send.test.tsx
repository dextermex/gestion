// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fr } from "@/lib/i18n/fr";

/**
 * The send dialog: opens with the dossier's signers, refuses on the spot a
 * signer who cannot be sent at the level chosen and says which, keeps the
 * caret while a field is typed into, and posts exactly what it shows.
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

async function typeInto(field: HTMLInputElement, text: string) {
  await act(async () => field.focus());
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  setter.call(field, "");
  field.dispatchEvent(new Event("input", { bubbles: true }));
  for (let i = 1; i <= text.length; i++) {
    await act(async () => {
      setter.call(field, text.slice(0, i));
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }
}

const LEASE = "0f0f0f0f-0000-4000-8000-0000000000b1";
const TENANT = "0f0f0f0f-0000-4000-8000-0000000000c1";

async function openDialog(levels: Array<"electronic_signature" | "advanced_electronic_signature">) {
  const { default: SignatureSend } = await import("@/components/gestion/SignatureSend");
  await act(async () =>
    root.render(
      <SignatureSend
        d={fr}
        locale="fr"
        leaseId={LEASE}
        tenants={[{ contactId: TENANT, firstName: "Anna", lastName: "Weber", email: "anna.weber@example.lu", phone: "", locale: "fr" }]}
        lessor={{ contactId: null, firstName: "Alex", lastName: "Test", email: "cabinet@example.lu", phone: "", locale: "fr" }}
        levels={levels}
        sandbox
      />,
    ),
  );
  // The dialog lives in a portal once mounted.
  await act(async () => (host.querySelector("[data-signature-send]") as HTMLButtonElement).click());
}

const form = () => document.body.querySelector("form") as HTMLFormElement;
const submit = async () => {
  await act(async () => form().dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
};

describe("the send dialog", () => {
  it("opens with the dossier's tenants and the lessor, and says it is the test environment", async () => {
    await openDialog(["electronic_signature"]);
    expect((document.getElementById("signer-0-last") as HTMLInputElement).value).toBe("Weber");
    expect((document.getElementById("signer-1-email") as HTMLInputElement).value).toBe("cabinet@example.lu");
    expect(document.body.textContent).toContain(fr.contrats.sendSandbox);
    // One level only: nothing to choose.
    expect(document.getElementById("signature-level")).toBeNull();
  });

  it("refuses an advanced signature without a mobile, says why, and sends nothing", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    await openDialog(["electronic_signature", "advanced_electronic_signature"]);
    const level = document.getElementById("signature-level") as HTMLSelectElement;
    await act(async () => {
      level.value = "advanced_electronic_signature";
      level.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await submit();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain(fr.contrats.errPhone);
    expect((document.getElementById("signer-0-phone") as HTMLInputElement).getAttribute("aria-invalid")).toBe("true");
  });

  it("keeps the caret while typing, then posts the signers as shown, the mobile in international form", async () => {
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ envelopeId: "e-1", status: "ongoing" }), { status: 201 }));
    vi.stubGlobal("fetch", fetchSpy);
    await openDialog(["electronic_signature"]);
    const phone = document.getElementById("signer-0-phone") as HTMLInputElement;
    await typeInto(phone, "+352 621 123 456");
    expect(document.activeElement).toBe(phone);
    expect(phone.value).toBe("+352 621 123 456");
    await submit();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/signature/envoyer");
    expect(JSON.parse(String(init.body))).toEqual({
      leaseId: LEASE,
      level: "electronic_signature",
      tenants: [{ contactId: TENANT, firstName: "Anna", lastName: "Weber", email: "anna.weber@example.lu", phone: "+352621123456", locale: "fr" }],
      lessor: { contactId: null, firstName: "Alex", lastName: "Test", email: "cabinet@example.lu", phone: null, locale: "fr" },
    });
    expect(refresh).toHaveBeenCalled();
  });

  it("says what the server refused in words, field by field when it names signers", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: "signers_invalid", issues: [{ position: 2, issues: ["email"] }] }), { status: 422 })),
    );
    await openDialog(["electronic_signature"]);
    await submit();
    expect((document.getElementById("signer-1-email") as HTMLInputElement).getAttribute("aria-invalid")).toBe("true");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "already_sent" }), { status: 409 })));
    await submit();
    expect(document.body.textContent).toContain(fr.contrats.errAlready);
  });
});
