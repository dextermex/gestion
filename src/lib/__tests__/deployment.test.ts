import { afterEach, describe, expect, it, vi } from "vitest";
import { previewEmpty, sampleDataAllowed, servesCustomers } from "@/lib/deployment";

/**
 * The two development switches never act where customers work: the
 * empty-state harness on no production deployment at all, the sample
 * cabinets on no deployment that serves the product's own address.
 */
describe("the development switches", () => {
  afterEach(() => vi.restoreAllMocks());

  it("leave both off when they are not set", () => {
    expect(previewEmpty({})).toBe(false);
    expect(sampleDataAllowed({})).toBe(false);
    expect(previewEmpty({ MORADA_PREVIEW_EMPTY: "true" })).toBe(false);
    expect(sampleDataAllowed({ MORADA_SAMPLE_DATA: "yes" })).toBe(false);
  });

  it("act on a local build, a preview deployment and the test suite", () => {
    for (const env of [{}, { VERCEL_ENV: "preview" }, { VERCEL_ENV: "development" }]) {
      expect(previewEmpty({ ...env, MORADA_PREVIEW_EMPTY: "1" })).toBe(true);
      expect(sampleDataAllowed({ ...env, MORADA_SAMPLE_DATA: "1" })).toBe(true);
    }
  });

  it("are ignored on the deployment that serves customers, and said once in the log", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const production = { VERCEL_ENV: "production" };
    expect(servesCustomers(production)).toBe(true);
    expect(servesCustomers({ ...production, NEXT_PUBLIC_APP_URL: "https://app.morada.lu/" })).toBe(true);
    expect(previewEmpty({ ...production, MORADA_PREVIEW_EMPTY: "1" })).toBe(false);
    expect(sampleDataAllowed({ ...production, MORADA_SAMPLE_DATA: "1" })).toBe(false);
    expect(previewEmpty({ ...production, MORADA_PREVIEW_EMPTY: "1" })).toBe(false);
    expect(sampleDataAllowed({ ...production, MORADA_SAMPLE_DATA: "1" })).toBe(false);
    const said = log.mock.calls.map((c) => String(c[0]));
    expect(said.filter((s) => s.startsWith("MORADA_PREVIEW_EMPTY"))).toHaveLength(1);
    expect(said.filter((s) => s.startsWith("MORADA_SAMPLE_DATA"))).toHaveLength(1);
  });

  it("keep the sample cabinets of a demonstration project at its own address, never the empty harness", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const demo = { VERCEL_ENV: "production", NEXT_PUBLIC_APP_URL: "https://demo.example.lu" };
    expect(servesCustomers(demo)).toBe(false);
    expect(sampleDataAllowed({ ...demo, MORADA_SAMPLE_DATA: "1" })).toBe(true);
    expect(previewEmpty({ ...demo, MORADA_PREVIEW_EMPTY: "1" })).toBe(false);
  });
});
