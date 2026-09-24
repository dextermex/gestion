// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TenantMessages, { type TenantConversationView } from "@/components/gestion/TenantMessages";
import { fr } from "@/lib/i18n/fr";

/**
 * The tenant's Messages on a phone: the list of conversations first, one
 * conversation over the whole screen once tapped (the space's chrome told
 * to step aside), a way back. Which pane the phone shows is a class the
 * stylesheet reads below `lg` (`max-lg:hidden`), so the test reads the
 * classes, the document's attribute, the address bar and the scroll calls,
 * the way a phone would. A laptop keeps its title, chips and card.
 */
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }) }));

const t = fr.tenant;
const manager = "Cabinet Reuter";
const labels = { empty: t.threadEmpty, noneYet: t.msgNoneYet, write: t.threadWrite, send: t.threadSend, sent: t.threadSent, failed: t.threadFailed, view: t.msgView, requestBadge: fr.messages.requestBadge, newRequest: t.reqNew };

const conversations: TenantConversationView[] = [
  {
    id: "c-3b",
    leaseId: "l-3b",
    label: "Apt 3B · Résidence Beaulieu",
    lastLabel: "09:00",
    preview: "Volet roulant bloqué",
    previewIsRequest: true,
    messages: [
      { id: "m-1", mine: true, kind: "tenant", from: t.threadYou, body: "Bonjour, une question sur le bail.", dayLabel: "22/09/2026", timeLabel: "08:40", requestId: null },
      { id: "m-2", mine: true, kind: "tenant", from: t.threadYou, body: "Volet roulant bloqué", dayLabel: "22/09/2026", timeLabel: "09:00", requestId: "r-1" },
    ],
    newRequestHref: "/locataire/demandes?nouvelle=1",
  },
  {
    id: "lease:l-old",
    leaseId: "l-old",
    label: "Studio 12 · Résidence Um Bierg",
    lastLabel: "",
    preview: "",
    previewIsRequest: false,
    messages: [],
    newRequestHref: null,
  },
];
const requests = {
  "r-1": { id: "r-1", title: "Volet roulant bloqué", description: "Le volet ne remonte plus.", statusLabel: "Envoyée", statusColor: "bg-sky-100 text-sky-800", attachments: [], href: "/locataire/demandes/r-1" },
};

let host: HTMLDivElement;
let root: Root;
let scrolls: Array<[number, number]>;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  scrolls = [];
  // A phone: below `lg`, scrolled a little way down its list.
  window.matchMedia = ((query: string) => ({ matches: query.includes("max-width"), media: query, onchange: null, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false })) as unknown as typeof window.matchMedia;
  window.scrollTo = ((x: number, y: number) => scrolls.push([x, y])) as unknown as typeof window.scrollTo;
  Object.defineProperty(window, "scrollY", { value: 240, configurable: true });
  window.history.replaceState(null, "", "/locataire/messages");
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

const render = async (props: Partial<React.ComponentProps<typeof TenantMessages>> = {}) => {
  await act(async () =>
    root.render(
      <TenantMessages
        conversations={conversations}
        requests={requests}
        managerName={manager}
        initialId="c-3b"
        initialView="list"
        focusRequestId={null}
        title={t.msgTitle}
        subtitle={t.msgSub}
        pickLabel={t.msgPick}
        labels={labels}
        backLabel={fr.messages.backToThreads}
        sampleNote={null}
        {...props}
      />,
    ),
  );
};

const click = async (el: Element | null) => {
  expect(el, "the control to click").not.toBeNull();
  await act(async () => (el as HTMLElement).click());
};

const rows = () => Array.from(document.querySelectorAll<HTMLButtonElement>("#tenant-conversations li > button"));
/** The card around the conversation. */
const chatPane = () => document.getElementById("tenant-messages-body")?.parentElement ?? null;
/** The title, the chips and the list: what a phone shows until a conversation is tapped. */
const listPane = () => document.querySelector("h1")?.parentElement?.parentElement ?? null;
const hiddenOnPhone = (el: Element | null) => Boolean(el?.classList.contains("max-lg:hidden"));
const backButton = () => document.querySelector<HTMLButtonElement>(`button[aria-label="${fr.messages.backToThreads}"]`);

describe("the tenant's Messages on a phone", () => {
  it("shows the list alone: the manager, the home, the last word, when", async () => {
    await render();
    expect(rows()).toHaveLength(2);
    const [first, second] = rows();
    expect(first.textContent).toContain(manager);
    expect(first.textContent).toContain("Apt 3B · Résidence Beaulieu");
    expect(first.textContent).toContain(fr.messages.requestBadge);
    expect(first.textContent).toContain("Volet roulant bloqué");
    expect(first.textContent).toContain("09:00");
    // A tenancy no word has been written to yet is still a row, saying so.
    expect(second.textContent).toContain("Studio 12 · Résidence Um Bierg");
    expect(second.textContent).toContain(t.msgNoneYet);
    // Nothing is open: the conversation's card is behind the list, the title on the screen.
    expect(hiddenOnPhone(listPane())).toBe(false);
    expect(hiddenOnPhone(chatPane())).toBe(true);
    expect(document.documentElement.hasAttribute("data-phone-chat")).toBe(false);
    // The laptop's chips are the laptop's: the other conversation, as an address of its own.
    const chip = document.querySelector<HTMLAnchorElement>('a[href="/locataire/messages?bail=l-old"]');
    expect(chip?.textContent).toBe("Studio 12 · Résidence Um Bierg");
    expect(chip?.closest("[class*='max-lg:hidden']")).not.toBeNull();
  });

  it("opens a tapped conversation over the whole screen, the chrome told to step aside, and comes back to the list where it was", async () => {
    await render();
    await click(rows()[1]);
    // The conversation has the screen: the card is a screen of its own, the list steps aside.
    expect(hiddenOnPhone(chatPane())).toBe(false);
    expect(chatPane()?.className).toContain("max-lg:h-dvh");
    expect(hiddenOnPhone(listPane())).toBe(true);
    // Its header: the way back and the manager's name; its composer, for this tenancy.
    expect(backButton()).not.toBeNull();
    expect(document.querySelector("h2")?.textContent).toBe(manager);
    expect(document.getElementById("tenant-messages-body")?.textContent).toContain(t.threadEmpty);
    expect(document.getElementById("tenant-message-body")).not.toBeNull();
    // The document says a conversation has the phone's screen: the space's bars read it and step aside.
    expect(document.documentElement.hasAttribute("data-phone-chat")).toBe(true);
    expect(window.location.search).toBe("?bail=l-old");
    // Opened from the top of the page; the list's place is remembered.
    expect(scrolls).toEqual([[0, 0]]);
    // Back: the list, where it was, the address clean, the chrome back.
    await click(backButton());
    expect(hiddenOnPhone(listPane())).toBe(false);
    expect(hiddenOnPhone(chatPane())).toBe(true);
    expect(document.documentElement.hasAttribute("data-phone-chat")).toBe(false);
    expect(window.location.search).toBe("");
    expect(scrolls).toEqual([
      [0, 0],
      [0, 240],
    ]);
  });

  it("opens straight on the conversation the address names, at the request", async () => {
    await render({ initialView: "chat", initialId: "c-3b", focusRequestId: "r-1" });
    expect(hiddenOnPhone(chatPane())).toBe(false);
    expect(hiddenOnPhone(listPane())).toBe(true);
    expect(document.documentElement.hasAttribute("data-phone-chat")).toBe(true);
    const card = document.querySelector('[data-request="r-1"] > div > div');
    expect(card?.className).toContain("ring-2");
    // The way to a new request stays in the header, as words for a laptop and a button for a thumb.
    const ways = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href="/locataire/demandes?nouvelle=1"]'));
    expect(ways.map((a) => a.className.includes("lg:hidden") && !a.className.includes("max-lg:hidden"))).toEqual([false, true]);
    expect(ways[1].getAttribute("aria-label")).toBe(t.reqNew);
  });
});
