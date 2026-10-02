import { SIGNATURE_LEVELS, type SignatureLevel } from "./envelope";

/**
 * Which electronic-signature provider the deployment is connected to, read
 * from its server-side variables, never from a browser. Youtrust (Yousign
 * until July 2026) is the one wired: its API key (YOUSIGN_API_KEY), the
 * environment (its sandbox unless YOUSIGN_ENV is "production", so nothing is
 * billed or binding by accident) and the eIDAS levels the account carries
 * (YOUSIGN_LEVELS, comma-separated; the simple level alone when unset).
 */
export type SignatureProviderId = "yousign";
export type ProviderEnv = "sandbox" | "production";

export interface SignatureStatus {
  configured: boolean;
  provider: SignatureProviderId | null;
  env: ProviderEnv;
  levels: SignatureLevel[];
}

const PROVIDER_LABELS: Record<SignatureProviderId, string> = { yousign: "Youtrust" };

export function signatureProviderLabel(id: SignatureProviderId): string {
  return PROVIDER_LABELS[id];
}

/** The levels the account carries, in eIDAS order; the simple level is always there. */
export function parseLevels(raw: string | undefined): SignatureLevel[] {
  const asked = new Set((raw ?? "").split(",").map((v) => v.trim()));
  asked.add("electronic_signature");
  return SIGNATURE_LEVELS.filter((l) => asked.has(l));
}

export function signatureProvider(env: Record<string, string | undefined> = process.env): SignatureStatus {
  const providerEnv: ProviderEnv = env.YOUSIGN_ENV === "production" ? "production" : "sandbox";
  const levels = parseLevels(env.YOUSIGN_LEVELS);
  if (env.YOUSIGN_API_KEY?.trim()) return { configured: true, provider: "yousign", env: providerEnv, levels };
  return { configured: false, provider: null, env: providerEnv, levels };
}
