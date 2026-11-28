import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/onboarding/tour/route";
import { isSampleData } from "@/lib/demo";
import { updateSignupUser } from "@/lib/signup/update-user";
import { getSession } from "@/lib/supabase/server";

vi.mock("@/lib/supabase/server", () => ({ getSession: vi.fn() }));
vi.mock("@/lib/demo", () => ({ isSampleData: vi.fn() }));
vi.mock("@/lib/signup/update-user", () => ({ updateSignupUser: vi.fn() }));

const request = (origin = "https://app.morada.lu") => new NextRequest("https://app.morada.lu/api/onboarding/tour", { method: "POST", headers: { origin } });
const session = (metadata: Record<string, unknown>) => ({ userId: "user-1", email: "a@example.lu", accessToken: "token", metadata });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isSampleData).mockResolvedValue(false);
  vi.mocked(updateSignupUser).mockResolvedValue({ error: null });
});

describe("POST /api/onboarding/tour", () => {
  it("records the tour seen and keeps the rest of morada_mobile", async () => {
    vi.mocked(getSession).mockResolvedValue(session({ morada_mobile: { quiz: { units: "1" }, offer: { units: 1, band: "b1", billing: "year", addon: false }, trial_started_at: "2026-11-27T10:00:00Z" } }));
    const res = await POST(request());
    expect(res.status).toBe(200);
    expect(updateSignupUser).toHaveBeenCalledWith("token", {
      data: { morada_mobile: { quiz: { units: "1" }, offer: { units: 1, band: "b1", billing: "year", addon: false }, trial_started_at: "2026-11-27T10:00:00Z", tour: 1 } },
    });
  });

  it("writes nothing when the account already saw it, or on a sample cabinet", async () => {
    vi.mocked(getSession).mockResolvedValue(session({ morada_mobile: { tour: 1 } }));
    expect((await POST(request())).status).toBe(200);
    vi.mocked(getSession).mockResolvedValue(session({}));
    vi.mocked(isSampleData).mockResolvedValue(true);
    expect((await POST(request())).status).toBe(200);
    expect(updateSignupUser).not.toHaveBeenCalled();
  });

  it("refuses another origin and a visitor without a session", async () => {
    vi.mocked(getSession).mockResolvedValue(session({}));
    expect((await POST(request("https://elsewhere.example"))).status).toBe(403);
    vi.mocked(getSession).mockResolvedValue(null);
    expect((await POST(request())).status).toBe(401);
    expect(updateSignupUser).not.toHaveBeenCalled();
  });

  it("says when the account could not be updated", async () => {
    vi.mocked(getSession).mockResolvedValue(session({}));
    vi.mocked(updateSignupUser).mockResolvedValue({ error: { code: "unreachable" } });
    expect((await POST(request())).status).toBe(502);
  });
});
