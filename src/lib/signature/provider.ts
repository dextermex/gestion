/**
 * The seam for electronic signature: which provider the deployment is
 * connected to, read from its server-side variables, never from a browser.
 * Nothing is connected yet: the register shows the funnel and says so, and
 * a sample cabinet plays the journey. Sending an envelope and receiving the
 * signed contract back into the register come with the provider's keys
 * (DocuSign first: eIDAS advanced and qualified signatures in the EU;
 * Yousign as the EU-native alternative).
 */
export type SignatureProviderId = "docusign" | "yousign";

export interface SignatureStatus {
  configured: boolean;
  provider: SignatureProviderId | null;
}

const PROVIDER_LABELS: Record<SignatureProviderId, string> = { docusign: "DocuSign", yousign: "Yousign" };

export function signatureProviderLabel(id: SignatureProviderId): string {
  return PROVIDER_LABELS[id];
}

/** What the deployment carries. DocuSign needs its four JWT-grant values; Yousign its API key. */
export function signatureProvider(): SignatureStatus {
  const env = process.env;
  if (env.DOCUSIGN_INTEGRATION_KEY && env.DOCUSIGN_USER_ID && env.DOCUSIGN_ACCOUNT_ID && env.DOCUSIGN_PRIVATE_KEY) {
    return { configured: true, provider: "docusign" };
  }
  if (env.YOUSIGN_API_KEY) return { configured: true, provider: "yousign" };
  return { configured: false, provider: null };
}
