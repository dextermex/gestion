import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { callForm, callJson } from "@/components/gestion/call";
import { renewSessionNow } from "@/lib/supabase/browser";

/**
 * A call answered "signed out" is tried once more after the browser renewed
 * its session; the person is sent to the door, with the way back, only when
 * that renewal failed too. What they typed travels with the second call.
 */
vi.mock("@/lib/supabase/browser", () => ({ renewSessionNow: vi.fn() }));

const assign = vi.fn();
const answer = (status: number, body: unknown = {}) => new Response(JSON.stringify(body), { status });

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("window", { location: { assign } });
  vi.stubGlobal("fetch", vi.fn());
});
afterEach(() => vi.unstubAllGlobals());

describe("a call from a screen", () => {
  it("comes back as it is when the session is good", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(answer(409, { error: "conflict" }));
    expect(await callJson("/api/x", "POST", { a: 1 }, "/app/x")).toEqual({ ok: false, status: 409, payload: { error: "conflict" } });
    expect(renewSessionNow).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("is sent again, with the same content, after a renewal", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(answer(401)).mockResolvedValueOnce(answer(200, { ok: true }));
    vi.mocked(renewSessionNow).mockResolvedValue(true);
    expect(await callJson("/api/x", "PATCH", { title: "Fuite" }, "/app/x")).toEqual({ ok: true, status: 200, payload: { ok: true } });
    expect(fetch).toHaveBeenCalledTimes(2);
    const [first, second] = vi.mocked(fetch).mock.calls;
    expect(second[0]).toBe(first[0]);
    expect((second[1] as RequestInit).method).toBe("PATCH");
    expect((second[1] as RequestInit).body).toBe(JSON.stringify({ title: "Fuite" }));
    expect(assign).not.toHaveBeenCalled();
  });

  it("goes to the door, with the way back, when the renewal fails or the second answer is the same", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(answer(401));
    vi.mocked(renewSessionNow).mockResolvedValue(false);
    expect(await callJson("/api/x", "POST", {}, "/app/messages?demande=1")).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(assign).toHaveBeenCalledWith("/connexion?next=%2Fapp%2Fmessages%3Fdemande%3D1");

    vi.mocked(fetch).mockResolvedValueOnce(answer(401)).mockResolvedValueOnce(answer(401));
    vi.mocked(renewSessionNow).mockResolvedValue(true);
    expect(await callJson("/api/x", "POST", {}, "/app/x")).toBeNull();
    expect(assign).toHaveBeenCalledTimes(2);
  });

  it("does the same for a form carrying a file", async () => {
    const form = new FormData();
    form.set("file", new Blob(["x"]), "x.pdf");
    vi.mocked(fetch).mockResolvedValueOnce(answer(401)).mockResolvedValueOnce(answer(201, { id: "d1" }));
    vi.mocked(renewSessionNow).mockResolvedValue(true);
    expect(await callForm("/api/documents", form, "/app/documents")).toEqual({ ok: true, status: 201, payload: { id: "d1" } });
    expect((vi.mocked(fetch).mock.calls[1][1] as RequestInit).body).toBe(form);
  });
});
