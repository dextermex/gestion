"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Field, Input, Modal, Select } from "@/components/pro/ui";
import type { Dict } from "@/lib/i18n/fr";
import type { Locale } from "@/lib/i18n/config";
import { fmt } from "@/lib/i18n/config";
import { euros } from "@/lib/types";
import { contractMissingLabels } from "@/lib/documents/labels";
import { describeMissing, missingOf } from "@/lib/documents/missing";
import { normalizePhone, signerIssues, usageForSending, type SignatureLevel, type SignerIssue, type SignerLocale } from "@/lib/signature/envelope";

/**
 * "Send for signature": the people who will sign, prefilled from the
 * dossier and the workspace's identity, each editable; the tenants' level;
 * what the sending will cost. The server checks everything again; nothing
 * leaves until it agrees. Only for a real account with a provider.
 */
export interface SendSigner {
  contactId: string | null;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  locale: SignerLocale;
}

type Issues = Record<number, SignerIssue[]>;

function SignerFields({
  d,
  index,
  signer,
  issues,
  phoneRequired,
  onChange,
}: {
  d: Dict;
  index: number;
  signer: SendSigner;
  issues: SignerIssue[];
  phoneRequired: boolean;
  onChange: (index: number, patch: Partial<SendSigner>) => void;
}) {
  const id = (k: string) => `signer-${index}-${k}`;
  return (
    <div className="crm-sign-fields">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label={d.contrats.fieldFirstName}>
          <Input id={id("first")} value={signer.firstName} autoComplete="off" maxLength={80} aria-invalid={issues.includes("name") || undefined} onChange={(e) => onChange(index, { firstName: e.target.value })} />
        </Field>
        <Field label={d.contrats.fieldLastName}>
          <Input id={id("last")} value={signer.lastName} autoComplete="off" maxLength={80} aria-invalid={issues.includes("name") || undefined} onChange={(e) => onChange(index, { lastName: e.target.value })} />
        </Field>
        <Field label={d.contrats.fieldEmail}>
          <Input id={id("email")} type="email" inputMode="email" value={signer.email} autoComplete="off" maxLength={254} aria-invalid={issues.includes("email") || undefined} onChange={(e) => onChange(index, { email: e.target.value })} />
        </Field>
        <Field label={d.contrats.fieldPhone} hint={phoneRequired ? d.contrats.phoneRequiredHint : d.contrats.phoneHint}>
          <Input id={id("phone")} type="tel" inputMode="tel" value={signer.phone} autoComplete="off" maxLength={32} aria-invalid={issues.includes("phone") || undefined} onChange={(e) => onChange(index, { phone: e.target.value })} />
        </Field>
      </div>
      {issues.length > 0 && (
        <p role="alert" className="crm-sign-issue">
          {issues.map((i) => (i === "name" ? d.contrats.errName : i === "email" ? d.contrats.errEmail : d.contrats.errPhone)).join(" ")}
        </p>
      )}
    </div>
  );
}

const ERRORS: Record<string, keyof Dict["contrats"]> = {
  not_configured: "errNotConfigured",
  level_unavailable: "errLevel",
  not_draft: "errNotDraft",
  already_sent: "errAlready",
  parties_changed: "errParties",
  template_not_validated: "errTemplate",
  no_template: "errTemplate",
  settings_incomplete: "errSettings",
  not_ready: "errNotReady",
  contract_incomplete: "errIdentity",
  schema_outdated: "errSchema",
  provider: "errProvider",
};

export default function SignatureSend({
  d,
  locale,
  leaseId,
  tenants,
  lessor,
  levels,
  sandbox,
}: {
  d: Dict;
  locale: Locale;
  leaseId: string;
  tenants: SendSigner[];
  lessor: SendSigner;
  levels: SignatureLevel[];
  sandbox: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [level, setLevel] = useState<SignatureLevel>(levels[0] ?? "electronic_signature");
  const [rows, setRows] = useState<SendSigner[]>([]);
  const [shown, setShown] = useState<Issues>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const levelOf = (i: number): SignatureLevel => (i < tenants.length ? level : "electronic_signature");
  const issuesOf = (list: SendSigner[], lvl: (i: number) => SignatureLevel): Issues => {
    const out: Issues = {};
    list.forEach((r, i) => {
      const found = signerIssues({ role: i < tenants.length ? "tenant" : "lessor", contactId: r.contactId, firstName: r.firstName, lastName: r.lastName, email: r.email, phone: r.phone.trim() ? r.phone : null, locale: r.locale, level: lvl(i) });
      if (found.length > 0) out[i] = found;
    });
    return out;
  };

  const usage = usageForSending(rows.map((_, i) => ({ level: levelOf(i) })));
  const price = usage.reduce((sum, l) => sum + l.quantity * l.unitPriceCents, 0);

  const start = () => {
    setRows([...tenants, lessor].map((r) => ({ ...r })));
    setLevel(levels[0] ?? "electronic_signature");
    setShown({});
    setError(null);
    setBusy(false);
    setOpen(true);
  };

  const change = (index: number, patch: Partial<SendSigner>) => {
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));
    if (shown[index]) setShown((prev) => ({ ...prev, [index]: [] }));
  };

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const found = issuesOf(rows, levelOf);
    if (Object.keys(found).length > 0) {
      setShown(found);
      const form = e.currentTarget;
      requestAnimationFrame(() => form.querySelector<HTMLInputElement>('[aria-invalid="true"]')?.focus());
      return;
    }
    setBusy(true);
    setError(null);
    const payload = (r: SendSigner) => ({ contactId: r.contactId, firstName: r.firstName.trim(), lastName: r.lastName.trim(), email: r.email.trim(), phone: normalizePhone(r.phone) ?? (r.phone.trim() || null), locale: r.locale });
    try {
      const res = await fetch("/api/signature/envoyer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leaseId, level, tenants: rows.slice(0, tenants.length).map(payload), lessor: payload(rows[tenants.length]) }),
      });
      if (res.ok) {
        setOpen(false);
        router.refresh();
        return;
      }
      const body = (await res.json().catch(() => ({}))) as { error?: string; reason?: string; issues?: Array<{ position: number; issues: SignerIssue[] }> };
      if (body.error === "signers_invalid" && body.issues) {
        const next: Issues = {};
        for (const i of body.issues) next[i.position - 1] = i.issues;
        setShown(next);
      } else if (body.error === "provider" && body.reason === "forbidden" && level !== "electronic_signature") {
        setError(d.contrats.errLevel);
      } else if (body.error === "contract_incomplete") {
        setError(describeMissing(missingOf(body as Record<string, unknown>), contractMissingLabels(d)));
      } else {
        const key = body.error ? ERRORS[body.error] : undefined;
        setError(key ? String(d.contrats[key]) : d.contrats.errGeneric);
      }
    } catch {
      setError(d.contrats.errGeneric);
    }
    setBusy(false);
  };

  const levelLabels: Record<SignatureLevel, string> = {
    electronic_signature: d.contrats.levelSimple,
    advanced_electronic_signature: d.contrats.levelAdvanced,
    qualified_electronic_signature: d.contrats.levelQualified,
  };

  return (
    <>
      <Button size="sm" variant="secondary" onClick={start} data-signature-send={leaseId}>
        {d.contrats.send}
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title={d.contrats.sendTitle} closeLabel={d.common.close} wide>
        <form className="space-y-5" onSubmit={submit} noValidate>
          <p className="text-sm leading-relaxed text-ink-soft">{d.contrats.sendIntro}</p>
          {levels.length > 1 && (
            <Field label={d.contrats.fieldLevel}>
              <Select id="signature-level" value={level} onChange={(e) => setLevel(e.target.value as SignatureLevel)}>
                {levels.map((l) => (
                  <option key={l} value={l}>
                    {levelLabels[l]}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <fieldset className="space-y-4">
            <legend className="crm-sign-legend">{d.contrats.sendTenants}</legend>
            {rows.slice(0, tenants.length).map((r, i) => (
              <SignerFields key={r.contactId ?? i} d={d} index={i} signer={r} issues={shown[i] ?? []} phoneRequired={level === "advanced_electronic_signature"} onChange={change} />
            ))}
          </fieldset>
          {rows.length > tenants.length && (
            <fieldset className="space-y-4">
              <legend className="crm-sign-legend">{d.contrats.sendLessor}</legend>
              <SignerFields d={d} index={tenants.length} signer={rows[tenants.length]} issues={shown[tenants.length] ?? []} phoneRequired={false} onChange={change} />
            </fieldset>
          )}
          <p className="crm-sign-note">{sandbox ? d.contrats.sendSandbox : fmt(d.contrats.sendPrice, { price: euros(price, locale) })}</p>
          {error && (
            <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              {d.common.cancel}
            </Button>
            <Button type="submit" loading={busy}>
              {busy ? d.contrats.sendBusy : d.contrats.sendSubmit}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
