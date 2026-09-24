"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Field, Input, Modal, Select } from "@/components/pro/ui";
import { Icon } from "@/components/pro/icons";
import { fmt } from "@/lib/i18n/config";

/**
 * "Importer un relevé (CSV)": the way every cabinet gets its operations in
 * when no bank connection exists (Luxembourg's API coverage is thin), and
 * the fallback when a consent lapses. A sheet asks for the account, an
 * existing one or a new one with its IBAN and registered holder, and the
 * file; the result says what landed, what was already known, and what the
 * matcher did with the rest.
 */
export interface BankImportLabels {
  button: string;
  title: string;
  intro: string;
  account: string;
  newAccount: string;
  accountLabel: string;
  iban: string;
  holder: string;
  file: string;
  submit: string;
  done: string;
  empty: string;
  failed: string;
  tooLarge: string;
  invalid: string;
  close: string;
}

export default function BankImport({
  accounts,
  labels,
  variant = "secondary",
}: {
  accounts: Array<{ id: string; label: string }>;
  labels: BankImportLabels;
  variant?: "primary" | "secondary";
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [label, setLabel] = useState("");
  const [iban, setIban] = useState("");
  const [holder, setHolder] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file || (accountId === "" && (!label.trim() || !iban.trim() || !holder.trim()))) {
      setError(labels.invalid);
      return;
    }
    setBusy(true);
    setError(null);
    setDone(null);
    const form = new FormData();
    form.set("file", file);
    if (accountId) form.set("bankAccountId", accountId);
    else {
      form.set("label", label.trim());
      form.set("iban", iban.trim());
      form.set("holderName", holder.trim());
    }
    try {
      const res = await fetch("/api/banque/import", { method: "POST", body: form });
      if (res.status === 401) {
        window.location.assign("/connexion?next=/app/banque");
        return;
      }
      const body = (await res.json().catch(() => ({}))) as { error?: string; imported?: number; skipped?: number; auto?: number; review?: number };
      if (res.ok) {
        setDone(fmt(labels.done, { imported: body.imported ?? 0, skipped: body.skipped ?? 0, auto: body.auto ?? 0, review: body.review ?? 0 }));
        if (fileRef.current) fileRef.current.value = "";
        router.refresh();
      } else {
        setError(body.error === "too_large" ? labels.tooLarge : body.error === "no_rows" ? labels.empty : body.error === "invalid" ? labels.invalid : labels.failed);
      }
    } catch {
      setError(labels.failed);
    }
    setBusy(false);
  };

  return (
    <>
      <Button variant={variant} onClick={() => setOpen(true)}>
        <Icon name="documents" size={16} />
        {labels.button}
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title={labels.title} closeLabel={labels.close}>
        <form onSubmit={submit} className="space-y-4">
          <p className="text-sm leading-relaxed text-ink-soft">{labels.intro}</p>
          <Field label={labels.account}>
            <Select id="bank-import-account" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label}
                </option>
              ))}
              <option value="">{labels.newAccount}</option>
            </Select>
          </Field>
          {accountId === "" && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label={labels.accountLabel}>
                <Input id="bank-import-label" value={label} maxLength={120} onChange={(e) => setLabel(e.target.value)} />
              </Field>
              <Field label={labels.iban}>
                <Input id="bank-import-iban" value={iban} maxLength={40} autoCapitalize="characters" spellCheck={false} onChange={(e) => setIban(e.target.value)} />
              </Field>
              <div className="sm:col-span-2">
                <Field label={labels.holder}>
                  <Input id="bank-import-holder" value={holder} maxLength={200} onChange={(e) => setHolder(e.target.value)} />
                </Field>
              </div>
            </div>
          )}
          <Field label={labels.file}>
            <input
              id="bank-import-file"
              ref={fileRef}
              type="file"
              accept=".csv,text/csv,text/plain"
              className="block w-full text-sm text-ink file:mr-3 file:rounded-xl file:border file:border-sand-200 file:bg-white file:px-3 file:py-2 file:text-sm file:font-semibold file:text-brand-700 hover:file:border-brand-300 max-sm:min-h-11"
            />
          </Field>
          {error && (
            <p role="alert" className="text-xs font-semibold leading-relaxed text-red-700">
              {error}
            </p>
          )}
          {done && (
            <p role="status" className="rounded-lg bg-emerald-50 px-3 py-2 text-xs font-semibold leading-relaxed text-emerald-800">
              {done}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              {labels.close}
            </Button>
            <Button type="submit" loading={busy}>
              {labels.submit}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
