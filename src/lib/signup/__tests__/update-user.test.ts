import { afterEach, expect, it, vi } from "vitest";
import { updateSignupUser } from "../update-user";

afterEach(() => vi.unstubAllGlobals());
it("uses the verified user's bearer token, without a stored server Auth session", async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
  vi.stubGlobal("fetch", fetcher);
  expect(await updateSignupUser("verified-token", { email: "alex@example.test" })).toEqual({ error: null });
  const [url, options] = fetcher.mock.calls[0];
  expect(new URL(url).pathname).toBe("/auth/v1/user");
  expect(new URL(url).searchParams.get("redirect_to")).toMatch(/\/inscription$/);
  expect(options).toEqual(expect.objectContaining({
    method: "PUT", cache: "no-store", body: JSON.stringify({ email: "alex@example.test" }),
    headers: expect.objectContaining({ Authorization: "Bearer verified-token" }),
  }));
});
it("preserves the Auth error code, but never exposes a provider error message", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error_code: "email_exists", msg: "private detail" }), { status: 422 })));
  expect(await updateSignupUser("token", {})).toEqual({ error: { code: "email_exists" } });
});
