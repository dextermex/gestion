"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Field, Input, Modal, Select } from "@/components/pro/ui";
import type { Dict } from "@/lib/i18n/fr";
import { ApiProblemNote } from "@/components/gestion/ApiErrors";
import DateField from "@/components/gestion/DateField";
import { networkProblem, readApiProblem, type ApiProblem } from "@/lib/api-errors";
import { invalidDayField } from "@/lib/forms";

const KINDS = ["building", "pno", "liability", "rent_guarantee", "pi", "other"] as const;

/** "Add a policy": persists through /api/assurances/create on a real
 *  account; the sample cabinets keep the explicitly-fake notice. */
export default function AssuranceCreate({
  d,
  real,
  propertyOptions,
}: {
  d: Dict;
  real: boolean;
  propertyOptions: Array<{ id: string; label: string }>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  // A refusal in words (src/lib/api-errors.ts), the form left as typed.
  const [error, setError] = useState<ApiProblem | null>(null);
  const [done, setDone] = useState(false);
  // The two days of the policy: the product's own date field hands back an ISO day, or nothing.
  const [startsOn, setStartsOn] = useState("");
  const [expiresOn, setExpiresOn] = useState("");
  useEffect(() => {
    if (open) {
      setSaving(false);
      setError(null);
      setDone(false);
      setStartsOn("");
      setExpiresOn("");
    }
  }, [open]);

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    // A date typed that is not a day is corrected before the policy is saved without it.
    const badDay = invalidDayField(e.currentTarget);
    if (badDay) {
      badDay.focus();
      return;
    }
    if (!real) {
      setDone(true);
      return;
    }
    const f = new FormData(e.currentTarget);
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/assurances/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: String(f.get("kind") ?? ""),
          provider: String(f.get("provider") ?? ""),
          policyNumber: String(f.get("policyNumber") ?? ""),
          premium: String(f.get("premium") ?? ""),
          propertyId: String(f.get("propertyId") ?? ""),
          startsOn,
          expiresOn,
        }),
      });
      if (!res.ok) {
        setError(await readApiProblem(res, d.apiErrors, { keepsInput: true, fallback: d.shell.createFailed }));
        setSaving(false);
        return;
      }
      setOpen(false);
      router.refresh();
    } catch {
      setError(networkProblem(d.apiErrors));
      setSaving(false);
    }
  };

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" aria-hidden>
          <path strokeLinecap="round" d="M12 5v14M5 12h14" />
        </svg>
        {d.assurances.add}
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title={d.assurances.add} closeLabel={d.common.close}>
        <form className="space-y-4" onSubmit={submit}>
          <div className="grid grid-cols-2 gap-3">
            <Field label={d.assurances.fieldKind}>
              <Select name="kind" defaultValue="building">
                {KINDS.map((k) => (
                  <option key={k} value={k}>
                    {d.status.insuranceKind[k]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={d.assurances.fieldProperty}>
              <Select name="propertyId" defaultValue="">
                <option value="">{d.assurances.scopeCabinet}</option>
                {propertyOptions.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label={d.assurances.fieldProvider}>
              <Input name="provider" required maxLength={120} placeholder="Foyer, Baloise, Lalux…" />
            </Field>
            <Field label={d.assurances.fieldNumber}>
              <Input name="policyNumber" maxLength={60} />
            </Field>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field label={d.assurances.fieldPremium}>
              <Input name="premium" inputMode="decimal" placeholder="1 260,00" />
            </Field>
            <Field label={d.assurances.fieldStarts}>
              <DateField value={startsOn} onChange={setStartsOn} placeholder={d.loyers.datePlaceholder} />
            </Field>
            <Field label={d.assurances.fieldExpires}>
              <DateField value={expiresOn} onChange={setExpiresOn} min={startsOn || undefined} placeholder={d.loyers.datePlaceholder} />
            </Field>
          </div>

          {done && !real && (
            <p role="status" className="rounded-lg bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-800">
              {d.common.demoCreateNotice}
            </p>
          )}
          <ApiProblemNote problem={error} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              {d.common.cancel}
            </Button>
            <Button type="submit" disabled={saving}>
              {d.shell.submitCreate}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
