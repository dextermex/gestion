// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import MessagesCenter, { type MessagesLabels, type RequestView, type ThreadView } from "@/components/gestion/MessagesCenter";
import { fr } from "@/lib/i18n/fr";
import { requestStatusMeta } from "@/lib/types";

/**
 * Messages on a phone: the list first, one conversation at a time, a way
 * back. The panes are the same on every screen size; which one the phone
 * shows is a class the stylesheet reads below `lg` (`max-lg:hidden`), so
 * the test reads the classes, the address bar and the scroll calls, the
 * way a phone would. The laptop keeps both panes: it never sees the class.
 */
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }) }));

const m = fr.messages;
const labels: MessagesLabels = {
  tabConversations: m.tabConversations,
  tabRequests: m.tabRequests,
  requestBadge: m.requestBadge,
  emptyThreads: m.emptyThreads,
  emptyRequests: m.emptyRequests,
  requestsHint: m.requestsHint,
  detailsTitle: m.detailsTitle,
  refuse: m.refuse,
  fieldTenant: m.fieldTenant,
  fieldProperty: m.fieldProperty,
  fieldCreated: m.fieldCreated,
  fieldActivity: m.fieldActivity,
  fieldStatus: m.fieldStatus,
  attachmentsTitle: m.attachmentsTitle,
  createIntervention: m.createIntervention,
  interventionCreated: m.interventionCreated,
  interventionOpen: m.interventionOpen,
  you: m.you,
  replyPlaceholder: m.replyPlaceholder,
  send: fr.common.send,
  sent: m.replySent,
  sendFailed: m.sendFailed,
  statusFailed: m.statusFailed,
  interventionFailed: m.interventionFailed,
  unreadAria: m.unreadAria,
  colSubject: m.colSubject,
  colTenant: m.colTenant,
  colProperty: m.colProperty,
  colDate: m.colDate,
  colActivity: m.colActivity,
  colStatus: m.colStatus,
  openThread: m.openThread,
  noThreadYet: m.noThreadYet,
  viewRequest: m.viewRequest,
  close: fr.common.close,
  backToThreads: m.backToThreads,
  backToRequests: m.backToRequests,
};

const request: RequestView = {
  id: "r-1",
  ref: "DEM-2026-001",
  title: "Volet roulant bloqué",
  description: "Le volet de la chambre ne remonte plus.",
  status: "todo",
  tenantName: "Marc Thill",
  placeLabel: "Apt 2 · Résidence Um Bierg",
  createdLabel: "22/09/2026",
  openedLabel: "Demande envoyée le 22/09/2026",
  activityAt: "2026-09-22T09:00:00.000Z",
  activityLabel: "22 sept.",
  threadId: "t-thill",
  interventionId: null,
  attachments: [],
  attachmentsLabel: null,
};

const threads: ThreadView[] = [
  {
    id: "t-thill",
    leaseId: "l-1",
    subject: "Apt 2 · Résidence Um Bierg",
    scopeLabel: "Apt 2 · Résidence Um Bierg",
    participantName: "Marc Thill",
    isTenancy: true,
    lastMessageAt: "2026-09-22T09:00:00.000Z",
    lastLabel: "22 sept.",
    unread: 0,
    preview: request.title,
    previewIsRequest: true,
    messages: [
      { id: "m-1", from: "Marc Thill", kind: "tenant", body: "Bonjour, une question sur le bail.", dayLabel: "22/09/2026", timeLabel: "08:40", requestId: null },
      { id: "m-2", from: "Marc Thill", kind: "tenant", body: request.title, dayLabel: "22/09/2026", timeLabel: "09:00", requestId: "r-1" },
    ],
  },
  {
    id: "t-bauer",
    leaseId: "l-2",
    subject: "Maison Bauer",
    scopeLabel: "Maison Bauer",
    participantName: "Lena Bauer",
    isTenancy: true,
    lastMessageAt: "2026-09-21T17:10:00.000Z",
    lastLabel: "21 sept.",
    unread: 2,
    preview: "Merci pour la clé.",
    previewIsRequest: false,
    messages: [{ id: "m-3", from: "Lena Bauer", kind: "tenant", body: "Merci pour la clé.", dayLabel: "21/09/2026", timeLabel: "17:10", requestId: null }],
  },
];

let host: HTMLDivElement;
let root: Root;
let scrolls: Array<[number, number]>;
let fetched: string[];

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  scrolls = [];
  fetched = [];
  // A phone: below `lg`, scrolled a little way down its list.
  window.matchMedia = ((query: string) => ({
    matches: query.includes("max-width"),
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
  window.scrollTo = ((x: number, y: number) => scrolls.push([x, y])) as unknown as typeof window.scrollTo;
  Object.defineProperty(window, "scrollY", { value: 240, configurable: true });
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    fetched.push(String(input));
    return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  window.history.replaceState(null, "", "/app/messages");
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

const render = async (props: Partial<React.ComponentProps<typeof MessagesCenter>> = {}) => {
  await act(async () =>
    root.render(
      <MessagesCenter
        threads={threads}
        requests={[request]}
        statusMeta={requestStatusMeta(fr)}
        labels={labels}
        title={m.title}
        subtitle={m.subtitle}
        legal={m.legal}
        initialTab="conversations"
        initialView="list"
        initialThreadId="t-thill"
        initialRequestId={null}
        writable
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

/** The pane that holds the conversation: the card around the chat body. */
const chatPane = () => document.getElementById("messages-body")?.parentElement ?? null;
/** The pane that holds the inbox: the first card of the conversations panel. */
const listPane = () => document.querySelector("#messages-panel-conversations > div");
const hiddenOnPhone = (el: Element | null) => Boolean(el?.classList.contains("max-lg:hidden"));
const rowOf = (name: string) => Array.from(document.querySelectorAll<HTMLButtonElement>("#messages-panel-conversations li > button")).find((b) => b.textContent?.includes(name)) ?? null;
const backButton = (label: string) => document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);

describe("Messages on a phone", () => {
  it("shows the list alone, most recent first, with nothing opened by itself", async () => {
    await render();
    const rows = Array.from(document.querySelectorAll("#messages-panel-conversations li > button"));
    expect(rows.map((r) => r.textContent?.slice(0, 10))).toEqual(["MTMarc Thi", "LBLena Bau"]);
    // The first conversation is the laptop's open one; the phone keeps it behind the list.
    expect(hiddenOnPhone(listPane())).toBe(false);
    expect(hiddenOnPhone(chatPane())).toBe(true);
    expect(document.querySelector("h1")?.textContent).toBe(m.title);
    // Each row: who, where, the last word (a request, badged), when, what is unread.
    const thill = rowOf("Marc Thill")!;
    expect(thill.textContent).toContain("Apt 2 · Résidence Um Bierg");
    expect(thill.textContent).toContain(m.requestBadge);
    expect(thill.textContent).toContain(request.title);
    expect(thill.textContent).toContain("22 sept.");
    expect(rowOf("Lena Bauer")!.querySelector("[role=img]")?.getAttribute("aria-label")).toBe("2 non lus");
    expect(thill.querySelector("[role=img]")).toBeNull();
  });

  it("opens a tapped conversation over the whole screen, reads it, and comes back to the list where it was", async () => {
    await render();
    await click(rowOf("Lena Bauer"));
    // The conversation has the screen: the list, the title and the tabs step aside.
    expect(hiddenOnPhone(chatPane())).toBe(false);
    expect(hiddenOnPhone(listPane())).toBe(true);
    expect(document.querySelector("h1")?.closest("[class*='max-lg:hidden']")).not.toBeNull();
    expect(document.querySelector("#messages-body h2, h2")?.textContent).toBe("Lena Bauer");
    expect(document.getElementById("messages-body")?.textContent).toContain("Merci pour la clé.");
    expect(window.location.search).toBe("?fil=t-bauer");
    // The document says a conversation has the phone's screen: the shell's floating card steps aside.
    expect(document.documentElement.hasAttribute("data-phone-chat")).toBe(true);
    // Opened from the top of the page; the list's place is remembered.
    expect(scrolls).toEqual([[0, 0]]);
    // What the tenant wrote is read, in the database too.
    expect(fetched).toEqual(["/api/conversations/t-bauer/lu"]);
    // Back: the list, where it was, the conversation no longer unread, the address clean.
    await click(backButton(m.backToThreads));
    expect(hiddenOnPhone(listPane())).toBe(false);
    expect(hiddenOnPhone(chatPane())).toBe(true);
    expect(window.location.search).toBe("");
    expect(document.documentElement.hasAttribute("data-phone-chat")).toBe(false);
    expect(scrolls).toEqual([
      [0, 0],
      [0, 240],
    ]);
    expect(rowOf("Lena Bauer")!.querySelector("[role=img]")).toBeNull();
  });

  it("lists the requests first, opens one in its conversation at the card, and comes back to the requests", async () => {
    await render({ initialTab: "requests" });
    // No conversation on the screen, the request as a row a thumb can hit.
    expect(document.getElementById("messages-body")).toBeNull();
    const row = Array.from(document.querySelectorAll<HTMLButtonElement>("#messages-panel-requests li > button")).find((b) => b.textContent?.includes(request.title)) ?? null;
    expect(row?.textContent).toContain("Marc Thill · Apt 2 · Résidence Um Bierg");
    expect(row?.textContent).toContain(m.statusTodo);
    await click(row);
    expect(hiddenOnPhone(chatPane())).toBe(false);
    expect(window.location.search).toBe("?demande=r-1");
    const card = document.querySelector('[data-request="r-1"] > div:nth-child(2) > div');
    expect(card?.className).toContain("ring-2");
    // Back leads to the requests, not to the conversations.
    await click(backButton(m.backToRequests));
    expect(document.getElementById("messages-panel-requests")).not.toBeNull();
    expect(document.getElementById("messages-body")).toBeNull();
    expect(window.location.search).toBe("?onglet=demandes");
  });

  it("opens straight on the conversation the address names", async () => {
    await render({ initialView: "chat", initialThreadId: "t-thill", initialRequestId: "r-1" });
    expect(hiddenOnPhone(chatPane())).toBe(false);
    expect(hiddenOnPhone(listPane())).toBe(true);
    expect(document.querySelector('[data-request="r-1"]')).not.toBeNull();
    // A laptop's classes are untouched: the list is `lg:col-span-4`, the conversation `lg:col-span-8`, side by side.
    expect(listPane()?.classList.contains("lg:col-span-4")).toBe(true);
    expect(chatPane()?.classList.contains("lg:col-span-8")).toBe(true);
  });
});
