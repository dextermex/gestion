"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Modal } from "@/components/pro/ui";
import { Icon } from "@/components/pro/icons";
import { callJson } from "./call";

/**
 * The register's rows, and the sheet one opens: everything a row does not
 * say (retention clock, fingerprint, origin) waits behind the row, so the
 * list stays a list. The name opens the file; the row opens the sheet.
 * Labels and dates arrive formatted. A piece of a tenancy says whether its
 * tenants read it in their space, and the desk can share it or take it back
 * from the sheet (`PATCH /api/documents/[id]/partage`).
 */
export interface DocumentRow {
  id: string;
  name: string;
  sealed: boolean;
  hasFile: boolean;
  classLabel: string;
  /** The document the application produced, when it did. */
  kindLabel: string | null;
  relatedLabel: string;
  addedLabel: string;
  sizeLabel: string;
  retentionLabel: string;
  retentionUntilLabel: string | null;
  sha256: string | null;
  /** The first characters of the fingerprint, what a row shows of a sealed piece. */
  shortSha: string | null;
  fileHref: string | null;
  /** A piece of a tenancy: whether its tenants read it; null when it is not a tenancy's, or the base does not say. */
  shared: boolean | null;
}

export interface ListLabels {
  colDoc: string;
  colClass: string;
  colAdded: string;
  colSize: string;
  details: string;
  close: string;
  openFile: string;
  klass: string;
  related: string;
  relatedNone: string;
  added: string;
  size: string;
  retention: string;
  kind: string;
  fingerprint: string;
  sealed: string;
  sealedNote: string;
  /** Said of a row with nothing behind it; null on a sample cabinet, whose rows are references. */
  noFile: string | null;
  sharedNote: string;
  notSharedNote: string;
  shareNow: string;
  shareWithdraw: string;
  shareFailed: string;
}

export default function DocumentList({ rows, labels, writable = false }: { rows: DocumentRow[]; labels: ListLabels; /** The switch that shares a piece is offered; off on a sample cabinet. */ writable?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState<DocumentRow | null>(null);
  /** What the sheet changed, until the page is read again. */
  const [sharedNow, setSharedNow] = useState<Record<string, boolean>>({});
  const [sharing, setSharing] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);
  const sharedOf = (r: DocumentRow): boolean | null => (r.id in sharedNow ? sharedNow[r.id] : r.shared);

  const share = async (r: DocumentRow, next: boolean) => {
    setShareError(null);
    setSharing(true);
    try {
      const res = await callJson(`/api/documents/${encodeURIComponent(r.id)}/partage`, "PATCH", { shared: next }, "/app/documents");
      if (!res) return;
      if (res.ok) {
        setSharedNow((m) => ({ ...m, [r.id]: res.payload.shared === true }));
        router.refresh();
      } else setShareError(labels.shareFailed);
    } catch {
      setShareError(labels.shareFailed);
    }
    setSharing(false);
  };
  const subtitle = (r: DocumentRow) => [r.kindLabel, r.relatedLabel, !r.hasFile && labels.noFile ? labels.noFile : null].filter(Boolean).join(" · ");

  return (
    <>
      <div className="table-scroll crm-doc-table">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-sand-100 text-left text-ink-soft">
              <th className="px-4 py-2.5 font-semibold">{labels.colDoc}</th>
              <th className="px-3 py-2.5 font-semibold max-sm:hidden">{labels.colClass}</th>
              <th className="px-3 py-2.5 font-semibold max-sm:hidden">{labels.colAdded}</th>
              <th className="px-3 py-2.5 text-right font-semibold max-md:hidden">{labels.colSize}</th>
              <th className="px-2 py-2.5" aria-hidden />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="crm-doc-row border-b border-sand-100 last:border-0" onClick={() => setOpen(r)} data-document-row={r.id}>
                <td className="px-4 py-3">
                  <div className="crm-doc-cell">
                    <span className={"crm-doc-icon" + (r.sealed ? " is-sealed" : "")} aria-hidden>
                      <Icon name={r.sealed ? "lock" : "documents"} size={18} />
                    </span>
                    <div className="min-w-0">
                      <p className="crm-doc-name">
                        {r.hasFile && r.fileHref ? (
                          <a href={r.fileHref} data-document-file={r.id} onClick={(e) => e.stopPropagation()}>
                            {r.name}
                          </a>
                        ) : (
                          <span>{r.name}</span>
                        )}
                      </p>
                      <p className="crm-doc-sub">
                        {subtitle(r)}
                        {r.sealed && r.shortSha && (
                          <span data-document-sha={r.id} title={r.sha256 ?? undefined}>
                            {subtitle(r) ? " · " : ""}
                            {labels.fingerprint} {r.shortSha}
                          </span>
                        )}
                        <span className="sm:hidden">
                          {subtitle(r) || (r.sealed && r.shortSha) ? " · " : ""}
                          {r.addedLabel}
                        </span>
                      </p>
                    </div>
                  </div>
                </td>
                <td className="px-3 py-3 font-medium text-ink max-sm:hidden">{r.classLabel}</td>
                <td className="whitespace-nowrap px-3 py-3 tabular-nums text-ink-soft max-sm:hidden">{r.addedLabel}</td>
                <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums text-ink-soft max-md:hidden">{r.sizeLabel}</td>
                <td className="px-2 py-2 text-right">
                  <button
                    type="button"
                    className="crm-doc-more"
                    aria-label={`${labels.details} : ${r.name}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      setOpen(r);
                    }}
                  >
                    <Icon name="chevron-right" size={16} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Modal
        open={open !== null}
        onClose={() => {
          setOpen(null);
          setShareError(null);
        }} title={open?.name ?? ""} closeLabel={labels.close}>
        {open && (
          <div className="crm-doc-sheet">
            <div className="crm-doc-sheet-head">
              <span className={"crm-doc-icon" + (open.sealed ? " is-sealed" : "")} aria-hidden>
                <Icon name={open.sealed ? "lock" : "documents"} size={18} />
              </span>
              <div className="min-w-0">
                <p className="crm-doc-sheet-class">{open.classLabel}</p>
                {open.sealed && <p className="crm-doc-sheet-sealed">{labels.sealed}</p>}
              </div>
            </div>
            <dl>
              <dt>{labels.related}</dt>
              <dd>{open.relatedLabel || labels.relatedNone}</dd>
              <dt>{labels.added}</dt>
              <dd>{open.addedLabel}</dd>
              <dt>{labels.size}</dt>
              <dd>{open.sizeLabel}</dd>
              <dt>{labels.retention}</dt>
              <dd>
                {open.retentionLabel}
                {open.retentionUntilLabel && <span className="block text-ink-soft">{open.retentionUntilLabel}</span>}
              </dd>
              {open.kindLabel && (
                <>
                  <dt>{labels.kind}</dt>
                  <dd>{open.kindLabel}</dd>
                </>
              )}
              {open.sha256 && (
                <>
                  <dt>{labels.fingerprint}</dt>
                  <dd className="crm-doc-sheet-sha">{open.sha256}</dd>
                </>
              )}
            </dl>
            {open.sealed && <p className="crm-doc-sheet-note">{labels.sealedNote}</p>}
            {sharedOf(open) !== null && (
              <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2" data-document-shared={sharedOf(open) ? "yes" : "no"}>
                <p className="text-sm text-ink-soft">{sharedOf(open) ? labels.sharedNote : labels.notSharedNote}</p>
                {writable && (
                  <Button size="sm" variant="secondary" loading={sharing} onClick={() => void share(open, !sharedOf(open))}>
                    {sharedOf(open) ? labels.shareWithdraw : labels.shareNow}
                  </Button>
                )}
                {shareError && (
                  <p role="alert" className="w-full text-xs font-semibold text-red-700">
                    {shareError}
                  </p>
                )}
              </div>
            )}
            <div className="crm-doc-sheet-actions">
              {open.hasFile && open.fileHref ? (
                <a href={open.fileHref} className="ui-button inline-flex items-center justify-center gap-2 rounded-full bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 max-sm:min-h-11">
                  <Icon name="external" size={16} />
                  {labels.openFile}
                </a>
              ) : (
                labels.noFile && <p className="text-sm text-ink-soft">{labels.noFile}</p>
              )}
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
