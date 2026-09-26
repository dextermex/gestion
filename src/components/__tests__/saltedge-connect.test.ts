import { describe, expect, it } from "vitest";
import { explainConnectFailure, type ConnectLabels } from "@/components/gestion/SaltEdgeConnect";

const labels: ConnectLabels = {
  notConfigured: "not configured",
  failed: "could not start",
  refusedCredentials: "credentials refused",
  appPending: "app pending",
  requestInvalid: "request invalid",
  signatureRequired: "signature required",
  failedWithCode: "could not start ({code})",
  diagnostic: "diagnostic",
};

describe("explainConnectFailure", () => {
  it("names the class of refusal the provider gave", () => {
    expect(explainConnectFailure("WrongSecret", labels)).toBe("credentials refused (WrongSecret)");
    expect(explainConnectFailure("ApiKeyNotFound", labels)).toBe("credentials refused (ApiKeyNotFound)");
    expect(explainConnectFailure("ClientPending", labels)).toBe("app pending (ClientPending)");
    expect(explainConnectFailure("ProviderInactive", labels)).toBe("app pending (ProviderInactive)");
    expect(explainConnectFailure("WrongRequestFormat", labels)).toBe("request invalid (WrongRequestFormat)");
    expect(explainConnectFailure("SignatureNotProvided", labels)).toBe("signature required (SignatureNotProvided)");
  });

  it("still prints an unknown class, and falls back to the plain failure without one", () => {
    expect(explainConnectFailure("SomethingNew", labels)).toBe("could not start (SomethingNew)");
    expect(explainConnectFailure("network", labels)).toBe("could not start (network)");
    expect(explainConnectFailure(null, labels)).toBe("could not start");
  });

  it("uses the plain failure when a screen gives no wording for the class", () => {
    const bare: ConnectLabels = { notConfigured: "not configured", failed: "could not start" };
    expect(explainConnectFailure("WrongSecret", bare)).toBe("could not start");
  });
});
