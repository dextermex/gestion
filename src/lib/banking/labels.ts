import type { ConnectLabels } from "@/components/gestion/SaltEdgeConnect";
import type { Dict } from "@/lib/i18n/fr";

/**
 * What a screen hands the bank controls: the dictionary's words for opening
 * the consent journey and for every way the provider can refuse it, and for
 * pulling the operations back. Said once here so Banque and Intégrations
 * say the same thing.
 */
export function connectLabels(d: Dict): ConnectLabels {
  return {
    notConfigured: d.banque.connectNotConfigured,
    failed: d.banque.connectFailed,
    refusedCredentials: d.banque.connectRefusedCredentials,
    appPending: d.banque.connectAppPending,
    requestInvalid: d.banque.connectRequestInvalid,
    signatureRequired: d.banque.connectSignatureRequired,
    failedWithCode: d.banque.connectFailedCode,
    diagnostic: d.banque.connectDiagnostic,
    opening: d.banque.connectOpening,
  };
}

export function syncLabels(d: Dict): { notConfigured: string; failed: string; schemaUnexposed: string } {
  return {
    notConfigured: d.banque.connectNotConfigured,
    failed: d.banque.syncFailed,
    schemaUnexposed: d.banque.schemaUnexposed,
  };
}
