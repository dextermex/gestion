import { expect, it } from "vitest";
import { authAppUrl } from "../auth/redirects";

it("defaults emailed links to the live app, even when requested from a local preview", () => {
  expect(authAppUrl(undefined, true)).toBe("https://app.morada.lu");
  expect(authAppUrl("", false)).toBe("https://app.morada.lu");
});

it("allows an explicit development callback, but rejects loopback in production", () => {
  expect(authAppUrl("http://127.0.0.1:4322", true)).toBe("http://127.0.0.1:4322");
  for (const address of ["http://localhost:3000", "https://localhost", "https://127.0.0.1", "http://[::1]:3000"]) {
    expect(authAppUrl(address, false)).toBe("https://app.morada.lu");
  }
});

it("rejects insecure or malformed configuration and accepts a trusted explicit HTTPS deployment", () => {
  for (const address of ["http://preview.example.test", "javascript:alert(1)", "https://user:pass@example.test", "https://example.test/path", "https://example.test/?next=evil", "invalid"]) {
    expect(authAppUrl(address, false)).toBe("https://app.morada.lu");
  }
  expect(authAppUrl("https://preview.example.test/", false)).toBe("https://preview.example.test");
});
