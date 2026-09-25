"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button } from "@/components/pro/ui";
import type { DemoTemplate } from "@/lib/demo/data";
import { callJson } from "./call";

/**
 * The templates the workspace's documents are produced from: one row per
 * kind and language, its version, whether this version was validated. The
 * preview opens the wording with fictitious values; validating records
 * the version, withdrawing forgets it. Nothing here changes a template.
 */
export interface TemplateRow extends DemoTemplate {
  label: string;
  languageLabel: string;
  statusLabel: string;
  notes: string;
  params: string[];
}

export interface TemplateLabels {
  colTemplate: string;
  colLanguage: string;
  colVersion: string;
  colStatus: string;
  preview: string;
  validate: string;
  unvalidate: string;
  validatedNote: string;
  withdrawnNote: string;
  failed: string;
  notesLabel: string;
  paramsLabel: string;
}

const BACK = "/app/reglages";

export default function TemplatesPanel({ rows, writable, sampleNote, labels }: { rows: TemplateRow[]; writable: boolean; sampleNote: string | null; labels: TemplateLabels }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const act = async (row: TemplateRow, validate: boolean) => {
    setError(null);
    setNote(null);
    if (!writable) {
      setNote(sampleNote ?? "");
      return;
    }
    setBusy(`${row.kind}:${row.lang}`);
    try {
      const url = `/api/documents/modeles/${encodeURIComponent(row.kind)}${validate ? "" : `?lang=${row.lang}`}`;
      const res = await callJson(url, validate ? "POST" : "DELETE", validate ? { lang: row.lang } : undefined, BACK);
      if (!res) return;
      if (res.ok) {
        setNote(validate ? labels.validatedNote : labels.withdrawnNote);
        router.refresh();
      } else setError(labels.failed);
    } catch {
      setError(labels.failed);
    }
    setBusy(null);
  };

  return (
    <div>
      <div className="table-scroll">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-sand-100 bg-sand-50/60 text-left text-[11px] uppercase tracking-wide text-ink-soft">
              <th className="px-3 py-2.5 font-semibold">{labels.colTemplate}</th>
              <th className="px-3 py-2.5 font-semibold">{labels.colLanguage}</th>
              <th className="px-3 py-2.5 font-semibold">{labels.colVersion}</th>
              <th className="px-3 py-2.5 font-semibold">{labels.colStatus}</th>
              <th className="px-3 py-2.5 text-right font-semibold">
                <span className="sr-only">{labels.validate}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const key = `${row.kind}:${row.lang}`;
              return (
                <tr key={key} className="border-b border-sand-50 align-top last:border-0" data-template={row.kind} data-template-lang={row.lang}>
                  <td className="px-3 py-3">
                    <p className="font-semibold text-ink">{row.label}</p>
                    <button type="button" className="mt-0.5 text-[11px] font-semibold text-brand-700 hover:underline" onClick={() => setOpen(open === key ? null : key)} aria-expanded={open === key}>
                      {labels.notesLabel}
                    </button>
                    {open === key && (
                      <div className="mt-1.5 max-w-md rounded-lg bg-sand-50 px-3 py-2 text-[11px] leading-relaxed text-ink-soft">
                        <p>{row.notes}</p>
                        {row.params.length > 0 && (
                          <p className="mt-1">
                            <span className="font-semibold text-ink">{labels.paramsLabel}</span> : {row.params.join(", ")}
                          </p>
                        )}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-3 text-xs text-ink-soft">{row.languageLabel}</td>
                  <td className="px-3 py-3 text-xs tabular-nums text-ink-soft">{row.version}</td>
                  <td className="px-3 py-3">
                    <span data-template-status={row.current ? "validated" : "pending"}>
                      <Badge className={row.current ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}>{row.statusLabel}</Badge>
                    </span>
                  </td>
                  <td className="px-3 py-3 text-right">
                    <div className="inline-flex flex-wrap items-center justify-end gap-2">
                      <a
                        href={`/api/documents/modeles/${encodeURIComponent(row.kind)}?lang=${row.lang}`}
                        target="_blank"
                        rel="noopener"
                        className="inline-flex min-h-9 items-center rounded-lg border border-sand-200 bg-white px-3 text-xs font-semibold text-brand-700 hover:border-brand-300"
                      >
                        {labels.preview}
                      </a>
                      {row.current ? (
                        <Button size="sm" variant="ghost" loading={busy === key} onClick={() => act(row, false)}>
                          {labels.unvalidate}
                        </Button>
                      ) : (
                        <Button size="sm" loading={busy === key} onClick={() => act(row, true)}>
                          {labels.validate}
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {note && (
        <p role="status" className="mt-3 text-xs font-semibold text-emerald-800">
          {note}
        </p>
      )}
      {error && (
        <p role="alert" className="mt-3 text-xs font-semibold text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}
