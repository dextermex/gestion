"use client";
import { useEffect, useRef } from "react";
import { parsePhoneNumberFromString } from "libphonenumber-js/min";
import type { SignupCopy } from "@/lib/i18n/signup";

export default function PhoneConfirmation({ number, busy, error, copy, onConfirm, onClose }: {
  number: string; busy: boolean; error: string; copy: SignupCopy; onConfirm: () => void; onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (number && !dialog.current?.open) dialog.current?.showModal();
    if (!number) dialog.current?.close();
  }, [number]);
  return <dialog ref={dialog} className="signup-confirm-dialog" aria-labelledby="confirm-phone-title" aria-describedby="confirm-phone-body" onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}>
    <h2 id="confirm-phone-title" className="font-display font-bold">{copy.confirmPhone}</h2>
    <p className="signup-confirm-number" dir="ltr">{parsePhoneNumberFromString(number)?.formatInternational() ?? number}</p>
    <p id="confirm-phone-body">{copy.confirmPhoneBody}</p>
    {error && <p className="signup-error" role="alert">{error}</p>}
    <button className="signup-primary" type="button" disabled={busy} onClick={onConfirm}>{busy ? copy.working : copy.sendCode}</button>
    <button className="signup-confirm-edit" type="button" disabled={busy} onClick={onClose}>{copy.editNumber}</button>
  </dialog>;
}
