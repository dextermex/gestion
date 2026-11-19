// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import MessagesCenter, { THREAD_LOAD_TIMEOUT_MS, type MessageView, type MessagesLabels, type ThreadView } from "@/components/gestion/MessagesCenter";
import { fr } from "@/lib/i18n/fr";
import { requestStatusMeta } from "@/lib/types";

/**
 * Opening a conversation the page did not read in full. The page reads one
 * conversation; any other is read when it is opened. The fault this guards
 * against: that read used to be a refresh of the page, which the router
 * drops as soon as the address is written again, and every click on a row
 * writes the address. A second click while the conversation was loading
 * therefore cancelled the load for good: the spinner stayed and further
 * clicks did nothing.
 *
 * The test plays the router the way the app router behaves: `refresh()` is
 * pending until the server answers, and a write to the address meanwhile
 * discards it. The conversation's own read route is a request the test
 * answers when it chooses. A screen that loads through the router fails the
 * first test; a screen that loads by a request of its own passes it.
 */
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** The router's pending refreshes: each is dropped by a later write to the address. */
let pendingRefreshes: Array<{ cancelled: boolean }> = [];
const router = {
  refresh: () => {
    pendingRefreshes.push({ cancelled: false });
  },
  push: () => {},
};
vi.mock("next/navigation", () => ({ useRouter: () => router }));

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
  sentNoMail: m.replySentNoMail,
  sendFailed: m.sendFailed,
  statusFailed: m.statusFailed,
  statusHeld: m.statusHeld,
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
  loading: fr.common.loading,
  loadFailed: m.threadLoadFailed,
  retry: m.threadRetry,
  showEarlier: m.threadEarlier,
};

const line = (id: string, body: string, at: string, kind: MessageView["kind"] = "tenant"): MessageView => ({
  id,
  from: kind === "manager" ? "Cabinet Test" : "Lena Bauer",
  kind,
  body,
  at,
  dayLabel: "21/09/2026",
  timeLabel: at.slice(11, 16),
  requestId: null,
});

/** Lena Bauer's conversation, whole: what the server holds. */
const BAUER: MessageView[] = [
  line("b-1", "Bonjour, la clé de la cave ?", "2026-09-21T08:00:00.000Z"),
  line("b-2", "Elle est dans la boîte aux lettres.", "2026-09-21T08:30:00.000Z", "manager"),
  line("b-3", "Merci pour la clé.", "2026-09-21T15:10:00.000Z"),
];

const thill: ThreadView = {
  id: "t-thill",
  leaseId: "l-1",
  subject: "Apt 2 · Résidence Um Bierg",
  scopeLabel: "Apt 2 · Résidence Um Bierg",
  participantName: "Marc Thill",
  isTenancy: true,
  lastMessageAt: "2026-09-22T07:00:00.000Z",
  lastLabel: "22 sept.",
  unread: 0,
  preview: "Bonjour, une question sur le bail.",
  previewIsRequest: false,
  loaded: true,
  messages: [{ ...line("m-1", "Bonjour, une question sur le bail.", "2026-09-22T07:00:00.000Z"), from: "Marc Thill" }],
};

/** The conversation as the page lists it when it read another one in full: its last word only, nothing unread. */
const bauerHead = (messages: MessageView[] = BAUER): ThreadView => ({
  id: "t-bauer",
  leaseId: "l-2",
  subject: "Maison Bauer",
  scopeLabel: "Maison Bauer",
  participantName: "Lena Bauer",
  isTenancy: true,
  lastMessageAt: messages[messages.length - 1].at,
  lastLabel: "21 sept.",
  unread: 0,
  preview: messages[messages.length - 1].body,
  previewIsRequest: false,
  loaded: false,
  messages: [messages[messages.length - 1]],
});
const bauerLoaded: ThreadView = { ...bauerHead(), loaded: true, messages: BAUER };

let host: HTMLDivElement;
let root: Root;
/** The read requests the screen made, each answered when the test says so. */
let reads: Array<{ url: string; signal: AbortSignal | null; answer: (messages: MessageView[] | number) => void }>;
let restoreHistory: () => void;
/** Every other request the screen made: the read marks, the sends. */
let posts: Array<{ url: string; body: Record<string, unknown> }>;
let visibility: DocumentVisibilityState;

const render = async (threads: ThreadView[], props: Partial<React.ComponentProps<typeof MessagesCenter>> = {}) => {
  await act(async () =>
    root.render(
      <MessagesCenter
        threads={threads}
        requests={[]}
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

/**
 * The server answers the router: a refresh still pending re-reads the page
 * for the address, which names the conversation, and the page comes back
 * with it read in full. One that was discarded brings nothing.
 */
const answerRouter = async (): Promise<number> => {
  const live = pendingRefreshes.filter((r) => !r.cancelled);
  pendingRefreshes = [];
  if (live.length > 0 && new URL(window.location.href).searchParams.get("fil") === "t-bauer") await render([thill, bauerLoaded]);
  return live.length;
};

const click = async (el: Element | null) => {
  expect(el, "the control to click").not.toBeNull();
  await act(async () => (el as HTMLElement).click());
};
const flush = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};
const rowOf = (name: string) => Array.from(document.querySelectorAll<HTMLButtonElement>("#messages-panel-conversations li > button")).find((b) => b.textContent?.includes(name)) ?? null;
const body = () => document.getElementById("messages-body");
const loading = () => document.querySelector("[data-thread-loading]");
const failure = () => document.querySelector("[data-thread-error]");
const readsOf = (id: string) => reads.filter((r) => r.url.startsWith(`/api/conversations/${id}/messages`));

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  reads = [];
  posts = [];
  pendingRefreshes = [];
  visibility = "visible";
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibility });
  // A laptop: the list and the open conversation side by side.
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
  window.scrollTo = (() => {}) as unknown as typeof window.scrollTo;
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (!/^\/api\/conversations\/[^/]+\/messages/.test(url) || (init?.method && init.method !== "GET")) {
      posts.push({ url, body: JSON.parse(typeof init?.body === "string" ? init.body : "{}") as Record<string, unknown> });
      return Promise.resolve(new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } }));
    }
    return new Promise<Response>((resolve, reject) => {
      const signal = init?.signal ?? null;
      signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      reads.push({
        url,
        signal,
        answer: (messages) =>
          resolve(
            typeof messages === "number"
              ? new Response(JSON.stringify({ error: "storage_failed" }), { status: messages, headers: { "Content-Type": "application/json" } })
              : new Response(JSON.stringify({ ok: true, messages: messages.map(({ requestId, ...rest }) => ({ ...rest, ticketId: requestId })), earlier: false }), { status: 200, headers: { "Content-Type": "application/json" } }),
          ),
      });
    });
  }) as typeof fetch;
  window.history.replaceState(null, "", "/app/messages");
  // The app router's rule: a write to the address while a refresh is pending discards that refresh.
  const { replaceState, pushState } = window.history;
  const discard = () => {
    for (const r of pendingRefreshes) r.cancelled = true;
  };
  window.history.replaceState = function (this: History, ...args: Parameters<History["replaceState"]>) {
    discard();
    return replaceState.apply(this, args);
  };
  window.history.pushState = function (this: History, ...args: Parameters<History["pushState"]>) {
    discard();
    return pushState.apply(this, args);
  };
  restoreHistory = () => {
    window.history.replaceState = replaceState;
    window.history.pushState = pushState;
  };
});
afterEach(async () => {
  vi.useRealTimers();
  await act(async () => root.unmount());
  restoreHistory();
  host.remove();
});

describe("opening a conversation the page did not read in full", () => {
  it("still opens it when its row is clicked a second time while it loads, and through a change of tab", async () => {
    await render([thill, bauerHead()]);
    await click(rowOf("Lena Bauer"));
    expect(document.querySelector("#messages-body")?.parentElement?.querySelector("h2")?.textContent).toBe("Lena Bauer");
    expect(loading()).not.toBeNull();
    // The second click, before anything came back: the address is written again.
    await click(rowOf("Lena Bauer"));
    // And a look at the other tab meanwhile.
    await click(document.getElementById("messages-tab-requests"));
    await click(document.getElementById("messages-tab-conversations"));
    expect(loading()).not.toBeNull();
    // The server answers whatever is still waiting for it: the router, the conversation's own request.
    await answerRouter();
    for (const read of readsOf("t-bauer")) read.answer(BAUER);
    await flush();
    expect(loading()).toBeNull();
    expect(failure()).toBeNull();
    expect(body()?.textContent).toContain("Bonjour, la clé de la cave ?");
    expect(body()?.textContent).toContain("Elle est dans la boîte aux lettres.");
    expect(body()?.textContent).toContain("Merci pour la clé.");
    // One request did it, however many times the row was clicked.
    expect(readsOf("t-bauer")).toHaveLength(1);
    expect(window.location.search).toBe("?fil=t-bauer");
  });

  it("does not depend on the router at all: no refresh is asked for to load a conversation", async () => {
    await render([thill, bauerHead()]);
    await click(rowOf("Lena Bauer"));
    expect(pendingRefreshes).toHaveLength(0);
    expect(readsOf("t-bauer")).toHaveLength(1);
    readsOf("t-bauer")[0].answer(BAUER);
    await flush();
    expect(body()?.querySelectorAll(".whitespace-pre-line")).toHaveLength(3);
    // Coming back to it later costs nothing: it is kept.
    await click(rowOf("Marc Thill"));
    await click(rowOf("Lena Bauer"));
    expect(loading()).toBeNull();
    expect(readsOf("t-bauer")).toHaveLength(1);
  });

  it("reads by itself the conversation it opens on when the page did not, without writing the address", async () => {
    const written = vi.spyOn(window.history, "replaceState");
    await render([bauerHead(), thill], { initialThreadId: "t-bauer" });
    expect(loading()).not.toBeNull();
    expect(written).not.toHaveBeenCalled();
    expect(pendingRefreshes).toHaveLength(0);
    readsOf("t-bauer")[0].answer(BAUER);
    await flush();
    expect(loading()).toBeNull();
    expect(body()?.textContent).toContain("Bonjour, la clé de la cave ?");
  });

  it("says so when the conversation does not answer in time, and loads it on a retry", async () => {
    vi.useFakeTimers();
    await render([thill, bauerHead()]);
    await click(rowOf("Lena Bauer"));
    expect(loading()).not.toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(THREAD_LOAD_TIMEOUT_MS + 10);
    });
    expect(readsOf("t-bauer")[0].signal?.aborted).toBe(true);
    expect(loading()).toBeNull();
    expect(failure()?.textContent).toContain(m.threadLoadFailed);
    // No second attempt behind the person's back: the error stays until they ask.
    expect(readsOf("t-bauer")).toHaveLength(1);
    const retry = Array.from(failure()?.querySelectorAll("button") ?? []).find((b) => b.textContent?.includes(m.threadRetry)) ?? null;
    await click(retry);
    expect(failure()).toBeNull();
    expect(loading()).not.toBeNull();
    expect(readsOf("t-bauer")).toHaveLength(2);
    readsOf("t-bauer")[1].answer(BAUER);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(loading()).toBeNull();
    expect(body()?.textContent).toContain("Merci pour la clé.");
  });

  it("says so when the read fails, and a click on the row tries again", async () => {
    await render([thill, bauerHead()]);
    await click(rowOf("Lena Bauer"));
    readsOf("t-bauer")[0].answer(502);
    await flush();
    expect(failure()).not.toBeNull();
    await click(rowOf("Lena Bauer"));
    expect(readsOf("t-bauer")).toHaveLength(2);
    readsOf("t-bauer")[1].answer(BAUER);
    await flush();
    expect(failure()).toBeNull();
    expect(body()?.textContent).toContain("Merci pour la clé.");
  });

  it("reads the conversation again when the page reports a newer last word", async () => {
    await render([thill, bauerHead()]);
    await click(rowOf("Lena Bauer"));
    readsOf("t-bauer")[0].answer(BAUER);
    await flush();
    // The list is read again (a poll, a focus): Lena wrote since.
    const more = [...BAUER, line("b-4", "Encore une question.", "2026-09-21T16:00:00.000Z")];
    await render([thill, bauerHead(more)]);
    expect(readsOf("t-bauer")).toHaveLength(2);
    // What was on the screen stays there while the new read runs.
    expect(loading()).toBeNull();
    expect(body()?.textContent).toContain("Merci pour la clé.");
    readsOf("t-bauer")[1].answer(more);
    await flush();
    expect(body()?.textContent).toContain("Encore une question.");
    expect(readsOf("t-bauer")).toHaveLength(2);
  });
});

describe("what is on the screen is read", () => {
  const unreadDot = (name: string) => rowOf(name)?.querySelector("[role=img]") ?? null;
  const marksOf = (id: string) => posts.filter((p) => p.url === `/api/conversations/${id}/lu`);

  it("marks the conversation a laptop opens by itself, with no click, up to its last message", async () => {
    const waiting: ThreadView = { ...thill, unread: 1 };
    await render([waiting, bauerHead()]);
    await flush();
    expect(marksOf("t-thill")).toEqual([{ url: "/api/conversations/t-thill/lu", body: { until: "2026-09-22T07:00:00.000Z" } }]);
    // The dot goes at once; the page is asked again for the list and the shell's count.
    expect(unreadDot("Marc Thill")).toBeNull();
    expect(pendingRefreshes.length).toBeGreaterThan(0);
    // Asked once, however many times the screen is drawn again with the same last message.
    await render([waiting, bauerHead()]);
    await flush();
    expect(marksOf("t-thill")).toHaveLength(1);
  });

  it("shows a message that arrives later as unread again, and reads it since it is on the screen", async () => {
    await render([{ ...thill, unread: 1 }, bauerHead()]);
    await flush();
    // The page comes back: read. Then Marc writes again.
    await render([thill, bauerHead()]);
    const next = { ...line("m-2", "Encore moi.", "2026-09-22T09:30:00.000Z"), from: "Marc Thill" };
    await render([{ ...thill, unread: 1, lastMessageAt: next.at, messages: [...thill.messages, next] }, bauerHead()]);
    await flush();
    expect(marksOf("t-thill").map((p) => p.body.until)).toEqual(["2026-09-22T07:00:00.000Z", "2026-09-22T09:30:00.000Z"]);
    expect(unreadDot("Marc Thill")).toBeNull();
  });

  it("reads a conversation opened from the list once its messages are there, not before", async () => {
    await render([thill, { ...bauerHead(), unread: 2 }]);
    await click(rowOf("Lena Bauer"));
    // Still loading: nothing is on the screen to have been read.
    expect(marksOf("t-bauer")).toEqual([]);
    expect(unreadDot("Lena Bauer")).not.toBeNull();
    readsOf("t-bauer")[0].answer(BAUER);
    await flush();
    expect(marksOf("t-bauer").map((p) => p.body.until)).toEqual(["2026-09-21T15:10:00.000Z"]);
    expect(unreadDot("Lena Bauer")).toBeNull();
  });

  it("does not read a conversation in a tab left in the background, and reads it when the tab is looked at again", async () => {
    visibility = "hidden";
    await render([{ ...thill, unread: 1 }, bauerHead()]);
    await flush();
    expect(marksOf("t-thill")).toEqual([]);
    expect(unreadDot("Marc Thill")).not.toBeNull();
    visibility = "visible";
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await flush();
    expect(marksOf("t-thill")).toHaveLength(1);
  });

  it("writes nothing on a sample cabinet: the dot goes on this screen only", async () => {
    await render([{ ...thill, unread: 1 }, bauerHead()], { writable: false, sampleNote: "Exemple" });
    await flush();
    expect(posts).toEqual([]);
    expect(unreadDot("Marc Thill")).toBeNull();
  });
});
