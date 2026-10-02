import "server-only";
import { signatureProvider } from "./provider";
import type { Provider } from "./service";
import { youtrustClient } from "./youtrust";

/**
 * The provider this deployment signs with, from its server-side variables,
 * or null. YOUSIGN_API_URL points the sandbox at a stand-in server for
 * tests; a production key always talks to Youtrust's own host.
 */
export function connectedProvider(env: Record<string, string | undefined> = process.env): Provider | null {
  const status = signatureProvider(env);
  const apiKey = env.YOUSIGN_API_KEY?.trim();
  if (!status.configured || !apiKey) return null;
  const baseUrl = status.env === "sandbox" ? env.YOUSIGN_API_URL?.trim() || undefined : undefined;
  return { status, client: youtrustClient({ apiKey, env: status.env, baseUrl }) };
}
