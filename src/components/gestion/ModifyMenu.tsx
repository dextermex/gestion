"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button, Field, Input, Modal, Select, Textarea } from "@/components/pro/ui";
import { Icon } from "@/components/pro/icons";
import { useDismiss } from "@/lib/useDismiss";
import type { EditField, EditTopic, MenuGroup, SpecialEditor } from "@/lib/gestion/editors";

/**
 * One button for changing anything about a property.
 *
 * An owner who wants to correct the rent should not have to remember which
 * screen owns it. So every edit in the product lives behind this single
 * "Modifier", grouped the way an owner thinks: the building, the tenancy
 * running in it, and the paperwork around both. Choosing an entry opens one
 * small form with the current values in it; saving writes to production and
 * the page behind re-reads itself.
 */

export interface ModifyLabels {
  trigger: string;
  cancel: string;
  save: string;
  saved: string;
  failed: string;
  emailTaken: string;
  /** Photos editor. */
  photoCurrent: string;
  photoChoose: string;
  photoRemove: string;
  photoNone: string;
  /** Payer accounts editor. */
  payerAdd: string;
  payerIban: string;
  payerNone: string;
  payerHint: string;
  remove: string;
  /** Indexation editor. */
  indexApply: string;
  indexBlocked: string;
  indexFrom: string;
  indexTo: string;
  /** Archive editor. */
  archiveConfirm: string;
  archiveBody: string;
  archiveBlocked: string;
  archiveDo: string;
}

type Open = { label: string; topic?: EditTopic; special?: SpecialEditor } | null;

export default function ModifyMenu({ groups, labels }: { groups: MenuGroup[]; labels: ModifyLabels }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [open, setOpen] = useState<Open>(null);
  const wrapRef = useDismiss<HTMLDivElement>(menuOpen, () => setMenuOpen(false));

  return (
    <div ref={wrapRef} className="relative">
      <button
        onClick={() => setMenuOpen((v) => !v)}
        aria-expanded={menuOpen}
        aria-haspopup="menu"
        className="tactile flex min-h-9 items-center gap-1.5 rounded-xl bg-brand-600 px-3.5 py-1.5 text-sm font-semibold text-white transition hover:bg-brand-700 max-sm:min-h-11"
      >
        <Icon name="edit" size={15} />
        {labels.trigger}
        <svg
          className={`h-3.5 w-3.5 transition-transform duration-200 ${menuOpen ? "rotate-180" : ""}`}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          aria-hidden
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {menuOpen && (
        <div
          role="menu"
          className="absolute right-0 z-40 mt-2 max-h-[70vh] w-72 overflow-y-auto rounded-2xl border border-sand-200 bg-white p-1.5 shadow-lg"
        >
          {groups.map((group, gi) => (
            <div key={group.label} className={gi > 0 ? "mt-1.5 border-t border-sand-100 pt-1.5" : ""}>
              <p className="px-2.5 py-1.5 text-[11px] font-bold uppercase tracking-wide text-ink-soft">
                {group.label}
              </p>
              {group.entries.map((entry) =>
                "href" in entry ? (
                  <Link
                    key={entry.id}
                    href={entry.href}
                    role="menuitem"
                    onClick={() => setMenuOpen(false)}
                    className="block rounded-lg px-2.5 py-2 text-sm text-ink transition hover:bg-sand-50"
                  >
                    {entry.label}
                  </Link>
                ) : (
                  <button
                    key={entry.id}
                    role="menuitem"
                    onClick={() => {
                      setMenuOpen(false);
                      setOpen({
                        label: entry.label,
                        topic: "topic" in entry ? entry.topic : undefined,
                        special: "special" in entry ? entry.special : undefined,
                      });
                    }}
                    className="block w-full rounded-lg px-2.5 py-2 text-left text-sm text-ink transition hover:bg-sand-50"
                  >
                    {entry.label}
                  </button>
                ),
              )}
            </div>
          ))}
        </div>
      )}

      {open?.topic && <TopicEditor topic={open.topic} labels={labels} onClose={() => setOpen(null)} />}
      {open?.special && (
        <SpecialEditorView special={open.special} title={open.label} labels={labels} onClose={() => setOpen(null)} />
      )}
    </div>
  );
}

/* ------------------------------ the flat form ----------------------------- */

function FieldView({
  field,
  value,
  onChange,
}: {
  field: EditField;
  value: string | boolean;
  onChange: (v: string | boolean) => void;
}) {
  if (field.kind === "toggle") {
    return (
      <label className="flex items-center gap-2.5 py-1.5">
        <input
          type="checkbox"
          checked={value === true}
          onChange={(e) => onChange(e.target.checked)}
          className="h-4 w-4 rounded border-sand-300 text-brand-600 focus:ring-brand-400"
        />
        <span className="text-sm text-ink">{field.label}</span>
      </label>
    );
  }
  const common = { value: String(value), onChange: (e: { target: { value: string } }) => onChange(e.target.value) };
  return (
    <Field label={field.label} hint={"hint" in field ? field.hint : undefined}>
      {field.kind === "select" ? (
        <Select {...common}>
          {field.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      ) : field.kind === "textarea" ? (
        <Textarea {...common} maxLength={field.maxLength} rows={3} />
      ) : (
        <Input
          {...common}
          type={field.kind === "date" ? "date" : "text"}
          inputMode={field.kind === "euro" || field.kind === "number" ? "decimal" : undefined}
          required={"required" in field ? field.required : undefined}
          maxLength={"maxLength" in field ? field.maxLength : undefined}
          placeholder={"placeholder" in field ? field.placeholder : undefined}
          className={
            ("mono" in field && field.mono ? "font-mono " : "") +
            (field.kind === "euro" || field.kind === "number" ? "text-right tabular-nums" : "")
          }
        />
      )}
    </Field>
  );
}

function TopicEditor({ topic, labels, onClose }: { topic: EditTopic; labels: ModifyLabels; onClose: () => void }) {
  const router = useRouter();
  const [values, setValues] = useState<Record<string, string | boolean>>(() =>
    Object.fromEntries(topic.fields.map((f) => [f.name, f.kind === "toggle" ? f.value : String(f.value)])),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(topic.endpoint, {
        method: topic.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...(topic.extra ?? {}), ...values }),
      });
      if (res.ok) {
        onClose();
        router.refresh();
        return;
      }
      if (res.status === 401) {
        // The session lapsed while the editor was open: sign in and come back here.
        window.location.assign(`/connexion?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
        return;
      }
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setError(data.error === "email_taken" ? labels.emailTaken : labels.failed);
    } catch {
      setError(labels.failed);
    }
    setSaving(false);
  };

  return (
    <Modal open title={topic.title} onClose={onClose} closeLabel={labels.cancel}>
      <form
        className="space-y-1"
        onSubmit={(e) => {
          e.preventDefault();
          if (!saving) void submit();
        }}
      >
        <div className="grid grid-cols-2 gap-x-3">
          {topic.fields.map((f) => (
            <div key={f.name} className={f.span === 2 || f.kind === "textarea" ? "col-span-2" : "col-span-2 sm:col-span-1"}>
              <FieldView field={f} value={values[f.name]} onChange={(v) => setValues((s) => ({ ...s, [f.name]: v }))} />
            </div>
          ))}
        </div>
        {topic.note && <p className="pt-2 text-xs leading-relaxed text-ink-soft">{topic.note}</p>}
        {error && (
          <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2 pt-4">
          <Button type="button" variant="ghost" onClick={onClose}>
            {labels.cancel}
          </Button>
          <Button type="submit" loading={saving}>
            {labels.save}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/* --------------------------- the shaped editors --------------------------- */

function SpecialEditorView({
  special,
  title,
  labels,
  onClose,
}: {
  special: SpecialEditor;
  title: string;
  labels: ModifyLabels;
  onClose: () => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const done = () => {
    onClose();
    router.refresh();
  };
  const call = async (input: RequestInfo, init: RequestInit) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(input, init);
      if (res.ok) return true;
      if (res.status === 401) {
        window.location.assign(`/connexion?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
        return false;
      }
      setError(labels.failed);
    } catch {
      setError(labels.failed);
    }
    setBusy(false);
    return false;
  };

  return (
    <Modal open title={title} onClose={onClose} closeLabel={labels.cancel}>
      {special.kind === "photos" && (
        <PhotosEditor special={special} labels={labels} busy={busy} call={call} done={done} />
      )}
      {special.kind === "payers" && (
        <PayersEditor special={special} labels={labels} busy={busy} call={call} done={done} />
      )}
      {special.kind === "indexation" && (
        <div>
          {special.allowed ? (
            <>
              <p className="rounded-xl bg-amber-50 p-3.5 text-sm text-ink">
                <span className="tabular-nums">{special.currentLabel}</span>
                <span className="mx-2 text-ink-soft">{labels.indexTo}</span>
                <span className="font-display text-base font-bold tabular-nums">{special.proposedLabel}</span>
              </p>
              <div className="flex justify-end gap-2 pt-4">
                <Button variant="ghost" onClick={onClose}>
                  {labels.cancel}
                </Button>
                <Button
                  loading={busy}
                  onClick={async () => {
                    if (await call(`/api/baux/${special.leaseId}/indexation`, { method: "POST" })) done();
                  }}
                >
                  {labels.indexApply}
                </Button>
              </div>
            </>
          ) : (
            <>
              <p className="text-sm text-ink-soft">{special.reason ?? labels.indexBlocked}</p>
              <div className="flex justify-end pt-4">
                <Button variant="ghost" onClick={onClose}>
                  {labels.cancel}
                </Button>
              </div>
            </>
          )}
        </div>
      )}
      {special.kind === "archive" && (
        <div>
          <p className="text-sm leading-relaxed text-ink">
            {special.blocked ? labels.archiveBlocked : labels.archiveBody}
          </p>
          <div className="flex justify-end gap-2 pt-4">
            <Button variant="ghost" onClick={onClose}>
              {labels.cancel}
            </Button>
            {!special.blocked && (
              <Button
                loading={busy}
                onClick={async () => {
                  const ok = await call(`/api/biens/${special.propertyId}`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ action: "archive" }),
                  });
                  if (ok) window.location.assign("/app/biens");
                }}
              >
                {labels.archiveDo}
              </Button>
            )}
          </div>
        </div>
      )}
      {error && (
        <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">
          {error}
        </p>
      )}
    </Modal>
  );
}

function PhotosEditor({
  special,
  labels,
  busy,
  call,
  done,
}: {
  special: Extract<SpecialEditor, { kind: "photos" }>;
  labels: ModifyLabels;
  busy: boolean;
  call: (i: RequestInfo, init: RequestInit) => Promise<boolean>;
  done: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-soft">{labels.photoCurrent}</p>
      <div className="mt-2 aspect-[16/10] w-full overflow-hidden rounded-xl bg-sand-100">
        {preview ?? special.currentUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={preview ?? special.currentUrl!} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-ink-soft">{labels.photoNone}</div>
        )}
      </div>

      <label className="tactile mt-3 flex cursor-pointer items-center justify-center gap-2 rounded-xl border-2 border-dashed border-sand-300 bg-sand-50 px-4 py-4 text-sm font-semibold text-ink transition hover:border-brand-300">
        <Icon name="plus" size={16} />
        {labels.photoChoose}
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp,image/avif"
          className="sr-only"
          onChange={(e) => {
            const f = e.target.files?.[0] ?? null;
            setFile(f);
            setPreview(f ? URL.createObjectURL(f) : null);
          }}
        />
      </label>

      <div className="flex justify-between gap-2 pt-4">
        {special.currentUrl ? (
          <Button
            variant="ghost"
            onClick={async () => {
              const ok = await call(`/api/biens/${special.propertyId}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ photoUrl: null }),
              });
              if (ok) done();
            }}
          >
            {labels.photoRemove}
          </Button>
        ) : (
          <span />
        )}
        <Button
          loading={busy}
          disabled={!file}
          onClick={async () => {
            if (!file) return;
            const body = new FormData();
            body.append("file", file);
            body.append("propertyId", special.propertyId);
            if (await call("/api/biens/photo", { method: "POST", body })) done();
          }}
        >
          {labels.save}
        </Button>
      </div>
    </div>
  );
}

function PayersEditor({
  special,
  labels,
  busy,
  call,
  done,
}: {
  special: Extract<SpecialEditor, { kind: "payers" }>;
  labels: ModifyLabels;
  busy: boolean;
  call: (i: RequestInfo, init: RequestInit) => Promise<boolean>;
  done: () => void;
}) {
  const [iban, setIban] = useState("");
  return (
    <div>
      {special.payers.length === 0 ? (
        <p className="text-sm text-ink-soft">{labels.payerNone}</p>
      ) : (
        <ul className="divide-y divide-sand-100">
          {special.payers.map((p) => (
            <li key={p} className="flex items-center justify-between gap-3 py-2 first:pt-0">
              <span className="font-mono text-sm tabular-nums text-ink">{p}</span>
              <button
                aria-label={labels.remove}
                className="text-ink-soft transition hover:text-red-600"
                onClick={async () => {
                  const ok = await call(
                    `/api/baux/${special.leaseId}/payeurs?iban=${encodeURIComponent(p)}`,
                    { method: "DELETE" },
                  );
                  if (ok) done();
                }}
              >
                <Icon name="trash" size={15} />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-4">
        <Field label={labels.payerIban}>
          <Input
            value={iban}
            onChange={(e) => setIban(e.target.value)}
            placeholder="LU28 0019 4006 4475 0000"
            className="font-mono tabular-nums"
            maxLength={40}
          />
        </Field>
      </div>
      <p className="mt-2 text-xs leading-relaxed text-ink-soft">{labels.payerHint}</p>
      <div className="flex justify-end pt-4">
        <Button
          loading={busy}
          disabled={iban.trim() === ""}
          onClick={async () => {
            const ok = await call(`/api/baux/${special.leaseId}/payeurs`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ payerIban: iban }),
            });
            if (ok) done();
          }}
        >
          {labels.payerAdd}
        </Button>
      </div>
    </div>
  );
}
