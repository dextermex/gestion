"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, Field, Input } from "@/components/pro/ui";
import { getSupabase } from "@/lib/supabase/browser";

/**
 * "Mes coordonnées": what the tenant may change themselves.
 *
 * The name is saved on their profile. The e-mail and the mobile are the
 * details the account signs in with, so each change is confirmed the way
 * sign-up confirmed them: the account system sends a six-digit code to the
 * new address or number, and nothing changes until the tenant types it in.
 * This form only asks the account system for that change and hands it the
 * code; it holds no password and decides nothing itself.
 *
 * None of this touches the landlord's file. With the box ticked, the
 * manager is told in the tenancy's conversation so the file can follow.
 */

export interface ProfileLabels {
  firstName: string;
  lastName: string;
  nameRequired: string;
  save: string;
  saved: string;
  saveFailed: string;
  notify: string;
  edit: string;
  cancel: string;
  codeInvalid: string;
  phoneLabel: string;
  phoneHint: string;
  phoneNone: string;
  phoneNew: string;
  phoneSend: string;
  phoneCodeSent: string;
  phoneCode: string;
  phoneVerify: string;
  phoneInvalid: string;
  phoneFailed: string;
  phoneCodeWrong: string;
  phoneChanged: string;
  emailLabel: string;
  emailHint: string;
  emailNew: string;
  emailSend: string;
  emailCodeSent: string;
  emailCode: string;
  emailInvalid: string;
  emailExists: string;
  emailRate: string;
  emailFailed: string;
  emailChanged: string;
}

type Step = "idle" | "code";
type Channel = "email" | "phone";

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
/** International form, the way the account system stores a mobile: +352621123456. */
const toE164 = (raw: string): string | null => {
  const compact = raw.replace(/[\s().-]/g, "").replace(/^00/, "+");
  return /^\+[1-9]\d{7,14}$/.test(compact) ? compact : null;
};

export default function TenantProfileForm({
  account,
  canNotify,
  labels,
  sampleNote,
}: {
  account: { firstName: string; lastName: string; email: string; phone: string | null };
  /** There is a tenancy in force with a conversation to tell the manager in. */
  canNotify: boolean;
  labels: ProfileLabels;
  /** On a sample cabinet, the form works but nothing is written. */
  sampleNote: string | null;
}) {
  const router = useRouter();
  const [firstName, setFirstName] = useState(account.firstName);
  const [lastName, setLastName] = useState(account.lastName);
  const [notify, setNotify] = useState(canNotify);
  const [nameState, setNameState] = useState<"idle" | "saving" | "saved" | "failed" | "invalid" | "sample">("idle");

  const [step, setStep] = useState<Record<Channel, Step>>({ email: "idle", phone: "idle" });
  const [value, setValue] = useState<Record<Channel, string>>({ email: account.email, phone: account.phone ?? "" });
  const [code, setCode] = useState<Record<Channel, string>>({ email: "", phone: "" });
  const [busy, setBusy] = useState<Channel | null>(null);
  const [note, setNote] = useState<Record<Channel, { tone: "ok" | "error" | "sample"; text: string } | null>>({ email: null, phone: null });

  const say = (channel: Channel, tone: "ok" | "error" | "sample", text: string) => setNote((n) => ({ ...n, [channel]: { tone, text } }));
  const move = (channel: Channel, to: Step) => setStep((s) => ({ ...s, [channel]: to }));

  const post = async (body: Record<string, unknown>): Promise<boolean> => {
    const res = await fetch("/api/locataire/profil", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (res.status === 401) {
      window.location.assign(`/connexion?next=${encodeURIComponent(window.location.pathname)}`);
      return false;
    }
    return res.ok;
  };

  const saveName = async () => {
    const first = firstName.trim();
    const last = lastName.trim();
    if (!first || !last) {
      setNameState("invalid");
      return;
    }
    if (sampleNote) {
      setNameState("sample");
      return;
    }
    setNameState("saving");
    try {
      const ok = await post({ action: "details", firstName: first, lastName: last, notify: canNotify && notify });
      setNameState(ok ? "saved" : "failed");
      if (ok) router.refresh();
    } catch {
      setNameState("failed");
    }
  };

  /** Asks the account system to send its code to the new address or number. */
  const request = async (channel: Channel) => {
    const target = channel === "email" ? value.email.trim().toLowerCase() : toE164(value.phone);
    if (!target || (channel === "email" && !EMAIL.test(target))) {
      say(channel, "error", channel === "email" ? labels.emailInvalid : labels.phoneInvalid);
      return;
    }
    if (sampleNote) {
      say(channel, "sample", sampleNote);
      return;
    }
    setBusy(channel);
    try {
      const { error } = await getSupabase().auth.updateUser(channel === "email" ? { email: target } : { phone: target });
      if (error) {
        const known = error.code === "email_exists" || error.code === "user_already_exists" ? labels.emailExists : error.code === "over_email_send_rate_limit" || error.code === "over_sms_send_rate_limit" || error.code === "over_request_rate_limit" ? labels.emailRate : null;
        say(channel, "error", known ?? (channel === "email" ? labels.emailFailed : labels.phoneFailed));
        return;
      }
      setValue((v) => ({ ...v, [channel]: target }));
      setCode((c) => ({ ...c, [channel]: "" }));
      move(channel, "code");
      say(channel, "ok", (channel === "email" ? labels.emailCodeSent : labels.phoneCodeSent).replace(channel === "email" ? "{email}" : "{phone}", target));
    } catch {
      say(channel, "error", channel === "email" ? labels.emailFailed : labels.phoneFailed);
    } finally {
      setBusy(null);
    }
  };

  /** Hands the account system the code; on its yes, the profile follows and the page reads the account back. */
  const confirm = async (channel: Channel) => {
    const token = code[channel].replace(/\s/g, "");
    if (!/^\d{6}$/.test(token)) {
      say(channel, "error", labels.codeInvalid);
      return;
    }
    setBusy(channel);
    try {
      const { error } = await getSupabase().auth.verifyOtp(channel === "email" ? { email: value.email, token, type: "email_change" } : { phone: value.phone, token, type: "phone_change" });
      if (error) {
        say(channel, "error", labels.phoneCodeWrong);
        return;
      }
      await post({ action: "sync", notify: canNotify && notify }).catch(() => false);
      move(channel, "idle");
      say(channel, "ok", channel === "email" ? labels.emailChanged : labels.phoneChanged);
      router.refresh();
    } catch {
      say(channel, "error", channel === "email" ? labels.emailFailed : labels.phoneFailed);
    } finally {
      setBusy(null);
    }
  };

  const noteClass = (tone: "ok" | "error" | "sample") => "text-xs font-semibold " + (tone === "error" ? "text-red-700" : tone === "sample" ? "rounded-lg bg-amber-50 px-2 py-1 text-amber-900" : "text-emerald-800");

  const changed = (channel: Channel) => {
    const typed = value[channel].trim();
    if (channel === "email") return typed.toLowerCase() !== account.email.toLowerCase();
    return (toE164(typed) ?? typed) !== (account.phone ? (toE164(account.phone) ?? account.phone) : "");
  };

  /** One button for the whole card: the name is saved, and each contact that changed asks for its code. */
  const saveAll = async (e: React.FormEvent) => {
    e.preventDefault();
    const nameChanged = firstName.trim() !== account.firstName || lastName.trim() !== account.lastName;
    const todo = (["phone", "email"] as const).filter((c) => step[c] !== "code" && changed(c));
    // Nothing changed: nothing is written, and the manager is told nothing.
    if (!nameChanged && todo.length === 0) {
      setNameState(sampleNote ? "sample" : "saved");
      return;
    }
    if (nameChanged) await saveName();
    for (const channel of todo) await request(channel);
  };

  const reset = () => {
    setFirstName(account.firstName);
    setLastName(account.lastName);
    setNameState("idle");
    setValue({ email: account.email, phone: account.phone ?? "" });
    setCode({ email: "", phone: "" });
    setStep({ email: "idle", phone: "idle" });
    setNote({ email: null, phone: null });
  };

  const contact = (channel: Channel) => {
    const isEmail = channel === "email";
    const at = step[channel];
    return (
      <div data-profile-channel={channel}>
        <Field label={isEmail ? labels.emailLabel : labels.phoneLabel}>
          <Input
            type={isEmail ? "email" : "tel"}
            inputMode={isEmail ? "email" : "tel"}
            autoComplete={isEmail ? "email" : "tel"}
            autoCapitalize="none"
            spellCheck={false}
            maxLength={isEmail ? 160 : 40}
            readOnly={at === "code"}
            value={value[channel]}
            onChange={(e) => {
              setValue((v) => ({ ...v, [channel]: e.target.value }));
              if (note[channel]) setNote((n) => ({ ...n, [channel]: null }));
            }}
          />
        </Field>
        <p className="mt-1.5 px-1 text-xs leading-relaxed text-ink-soft">{isEmail ? labels.emailHint : labels.phoneHint}</p>
        {at === "code" && (
          <div className="mt-3 space-y-3 rounded-2xl border border-sand-200 bg-sand-50 p-4">
            <Field label={isEmail ? labels.emailCode : labels.phoneCode}>
              <Input inputMode="numeric" autoComplete="one-time-code" maxLength={8} value={code[channel]} onChange={(e) => setCode((c) => ({ ...c, [channel]: e.target.value }))} />
            </Field>
            <div className="flex flex-wrap gap-2">
              <Button type="button" className="rounded-xl!" loading={busy === channel} onClick={() => void confirm(channel)}>
                {labels.phoneVerify}
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="rounded-xl!"
                disabled={busy === channel}
                onClick={() => {
                  move(channel, "idle");
                  setValue((v) => ({ ...v, [channel]: isEmail ? account.email : (account.phone ?? "") }));
                  setNote((n) => ({ ...n, [channel]: null }));
                }}
              >
                {labels.cancel}
              </Button>
            </div>
          </div>
        )}
        {note[channel] && (
          <p role="status" className={"mt-2 " + noteClass(note[channel]!.tone)}>
            {note[channel]!.text}
          </p>
        )}
      </div>
    );
  };

  return (
    <form onSubmit={saveAll} className="space-y-4" noValidate>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label={labels.firstName}>
          <Input name="given-name" autoComplete="given-name" maxLength={60} value={firstName} onChange={(e) => { setFirstName(e.target.value); if (nameState !== "idle") setNameState("idle"); }} />
        </Field>
        <Field label={labels.lastName}>
          <Input name="family-name" autoComplete="family-name" maxLength={60} value={lastName} onChange={(e) => { setLastName(e.target.value); if (nameState !== "idle") setNameState("idle"); }} />
        </Field>
      </div>
      {contact("phone")}
      {contact("email")}
      {canNotify && (
        <label className="flex min-h-11 cursor-pointer items-start gap-3 text-sm text-ink">
          <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} className="mt-0.5 h-5 w-5 shrink-0 rounded accent-brand-600" />
          <span>{labels.notify}</span>
        </label>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" className="rounded-xl!" loading={nameState === "saving" || busy !== null}>
          {labels.save}
        </Button>
        <Button type="button" variant="secondary" className="rounded-xl!" onClick={reset}>
          {labels.cancel}
        </Button>
        <p role="status" className={noteClass(nameState === "saved" ? "ok" : nameState === "sample" ? "sample" : "error")}>
          {nameState === "saved" ? labels.saved : nameState === "failed" ? labels.saveFailed : nameState === "invalid" ? labels.nameRequired : nameState === "sample" ? sampleNote : ""}
        </p>
      </div>
    </form>
  );
}
