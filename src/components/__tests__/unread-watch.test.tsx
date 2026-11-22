// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import UnreadWatch from "@/components/gestion/UnreadWatch";

/**
 * The shell's unread count kept current without a reload: a light read
 * now and then while the tab is visible, at once on focus, and the page
 * read again only when what the database holds differs from what the
 * layout drew.
 */
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let refreshes = 0;
let pathname = "/app";
const router = { refresh: () => void (refreshes += 1) };
vi.mock("next/navigation", () => ({ useRouter: () => router, usePathname: () => pathname }));

let host: HTMLDivElement;
let root: Root;
let asked: string[];
/** What the read route answers now. */
let answer: { status: number; signature: string | null };
let visibility: DocumentVisibilityState;

const render = async (signature: string) => {
  await act(async () => root.render(<UnreadWatch endpoint="/api/conversations" signature={signature} fastOn="/app/messages" />));
};
const pass = async (ms: number) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

beforeEach(() => {
  vi.useFakeTimers();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  refreshes = 0;
  pathname = "/app";
  asked = [];
  answer = { status: 200, signature: "0|0" };
  visibility = "visible";
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibility });
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    asked.push(String(input));
    return new Response(JSON.stringify({ ok: answer.status === 200, signature: answer.signature }), { status: answer.status, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
});

describe("the unread count, kept current", () => {
  it("asks every minute away from Messages, and reads the page again only when something changed", async () => {
    await render("0|0");
    expect(asked).toEqual([]);
    await pass(60_000);
    expect(asked).toEqual(["/api/conversations"]);
    expect(refreshes).toBe(0);
    // A tenant wrote: the database now holds one unread message.
    answer.signature = "1|1790000000000";
    await pass(60_000);
    expect(refreshes).toBe(1);
    // The layout drew the new count: the two agree again, nothing more is asked of the router.
    await render("1|1790000000000");
    await pass(60_000);
    expect(refreshes).toBe(1);
  });

  it("asks every fifteen seconds on the Messages screen, and at once on arriving there", async () => {
    pathname = "/app/messages";
    await render("0|0");
    await pass(0);
    expect(asked).toHaveLength(1);
    await pass(15_000);
    expect(asked).toHaveLength(2);
    await pass(15_000);
    expect(asked).toHaveLength(3);
  });

  it("asks nothing while the tab is hidden, and at once when it is looked at again", async () => {
    await render("0|0");
    visibility = "hidden";
    await pass(180_000);
    expect(asked).toEqual([]);
    visibility = "visible";
    answer.signature = "2|1790000000000";
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new Event("focus"));
      await vi.advanceTimersByTimeAsync(0);
    });
    // The two events arrive together: one read.
    expect(asked).toHaveLength(1);
    expect(refreshes).toBe(1);
  });

  it("asks the router again when a refresh was dropped, a few times at most for one answer", async () => {
    await render("0|0");
    answer.signature = "1|1790000000000";
    // The layout never draws the new count (the refresh is dropped each time, or the two disagree for good).
    await pass(60_000 * 6);
    expect(asked).toHaveLength(6);
    expect(refreshes).toBe(3);
    // A new answer is a new reason to read the page.
    answer.signature = "2|1790000000001";
    await pass(60_000);
    expect(refreshes).toBe(4);
  });

  it("says nothing when the route cannot answer, and stops when the session is over", async () => {
    await render("0|0");
    answer = { status: 200, signature: null };
    await pass(60_000);
    answer = { status: 502, signature: "9|9" };
    await pass(60_000);
    expect(refreshes).toBe(0);
    answer = { status: 401, signature: null };
    await pass(60_000);
    const before = asked.length;
    await pass(60_000 * 5);
    expect(asked).toHaveLength(before);
    expect(refreshes).toBe(0);
  });
});
