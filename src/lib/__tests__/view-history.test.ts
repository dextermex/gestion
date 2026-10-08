// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createElement, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useViewHistory } from "@/lib/view-history";

/**
 * A conversation opened over a phone's list is a history entry: opening it
 * pushes one, the back gesture pops it and the screen follows the address,
 * and a conversation the page was opened on (no entry under it) is left
 * the component's own way.
 */
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
let api: { view: string; enter: (url: URL) => void; leave: (fallback: () => void) => void };
const popped: string[] = [];

function Harness() {
  const [view, setView] = useState("list");
  const { enter, leave } = useViewHistory((url) => {
    popped.push(url.search);
    const chat = url.searchParams.has("fil");
    setView(chat ? "chat" : "list");
    return chat;
  });
  api = { view, enter, leave };
  return createElement("p", null, view);
}

beforeEach(async () => {
  popped.length = 0;
  window.history.replaceState(null, "", "/app/messages");
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root.render(createElement(Harness)));
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

const pop = async (path: string) => {
  window.history.replaceState(null, "", path);
  await act(async () => {
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
};

describe("a view opened over the list as a history entry", () => {
  it("pushes one entry for the view, without a state of its own", () => {
    const push = vi.spyOn(window.history, "pushState");
    api.enter(new URL("/app/messages?fil=t-1", window.location.href));
    expect(push).toHaveBeenCalledTimes(1);
    expect(push.mock.calls[0][0]).toBeNull();
    expect(window.location.search).toBe("?fil=t-1");
  });

  it("pops the entry it pushed, and otherwise leaves the move to the caller", () => {
    const back = vi.spyOn(window.history, "back").mockImplementation(() => {});
    const fallback = vi.fn();
    api.leave(fallback);
    expect(fallback).toHaveBeenCalledTimes(1);
    expect(back).not.toHaveBeenCalled();
    api.enter(new URL("/app/messages?fil=t-1", window.location.href));
    api.leave(fallback);
    expect(back).toHaveBeenCalledTimes(1);
    expect(fallback).toHaveBeenCalledTimes(1);
  });

  it("follows the browser to the address it landed on, and counts the entry the browser went forward into", async () => {
    const back = vi.spyOn(window.history, "back").mockImplementation(() => {});
    api.enter(new URL("/app/messages?fil=t-1", window.location.href));
    await pop("/app/messages");
    expect(host.textContent).toBe("list");
    expect(popped).toEqual([""]);
    // The entry is gone: the next way back is the caller's own.
    const fallback = vi.fn();
    api.leave(fallback);
    expect(fallback).toHaveBeenCalledTimes(1);
    // Forward into the conversation again: there is an entry to pop once more.
    await pop("/app/messages?fil=t-1");
    expect(host.textContent).toBe("chat");
    api.leave(fallback);
    expect(back).toHaveBeenCalledTimes(1);
    expect(fallback).toHaveBeenCalledTimes(1);
  });
});
