import type { Dict } from "@/lib/i18n/fr";
import type { RequestKind, TECHNICAL_CATEGORIES } from "@/lib/portal/types";

/** The strings the new-request form needs, picked on the server and handed to the client. */
export function requestLabels(d: Dict) {
  return {
    open: d.tenant.reqNew,
    kind: d.tenant.reqKind,
    kinds: {
      technical: [d.tenant.kindTechnical, d.tenant.kindTechnicalSub],
      document: [d.tenant.kindDocument, d.tenant.kindDocumentSub],
      question: [d.tenant.kindQuestion, d.tenant.kindQuestionSub],
      other: [d.tenant.kindOther, d.tenant.kindOtherSub],
    } as Record<RequestKind, [string, string]>,
    category: d.tenant.formCategory,
    categories: {
      heating: d.tenant.catHeating,
      plumbing: d.tenant.catPlumbing,
      electrics: d.tenant.catElectric,
      damp_mould: d.tenant.catDamp,
      locks_keys: d.tenant.catLock,
      appliances: d.tenant.catAppliances,
      gas: d.tenant.catGas,
      other: d.tenant.catOther,
    } as Record<(typeof TECHNICAL_CATEGORIES)[number], string>,
    gasWarning: d.tenant.gasWarning,
    urgency: d.tenant.formUrgency,
    urgencies: { routine: d.tenant.urgRoutine, priority: d.tenant.urgPriority, urgent: d.tenant.urgUrgent },
    title: d.tenant.formTitle,
    titleHint: d.tenant.formTitleHint,
    description: d.tenant.formDesc,
    descriptionHint: d.tenant.formDescHint,
    photos: d.tenant.formPhoto,
    photosHint: d.tenant.formPhotoHint,
    send: d.tenant.formSend,
    sending: d.tenant.sending,
    uploading: d.tenant.uploading,
    sent: d.tenant.reqSent,
    failed: d.tenant.reqFailed,
    noLease: d.tenant.reqNoLease,
    back: d.common.back,
    cancel: d.common.cancel,
    close: d.common.close,
  };
}
export type RequestLabels = ReturnType<typeof requestLabels>;
