"use client";

import { useState } from "react";

/**
 * The spaces a person may manage, in the account menu, when there is more
 * than one: the space on screen is marked, choosing another makes it the
 * one every screen and every action works in, on this browser, until the
 * person chooses again. The page is loaded afresh on the dashboard, since
 * the record on screen belongs to the space being left.
 */
export interface WorkspaceChoice {
  id: string;
  name: string;
  active: boolean;
}

export default function WorkspaceSwitch({ workspaces, labels }: { workspaces: WorkspaceChoice[]; labels: { title: string; current: string; failed: string } }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  if (workspaces.length < 2) return null;

  const choose = async (id: string) => {
    setBusy(id);
    setFailed(false);
    try {
      const res = await fetch("/api/espace/actif", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ workspaceId: id }) });
      if (res.status === 401) {
        window.location.assign("/connexion?next=/app");
        return;
      }
      if (res.ok) {
        window.location.assign("/app");
        return;
      }
      setFailed(true);
    } catch {
      setFailed(true);
    }
    setBusy(null);
  };

  return (
    <div className="mt-1 border-t border-sand-100 pt-1">
      <p className="px-3 pb-1 pt-2 text-[11px] font-bold uppercase tracking-wide text-ink-soft">{labels.title}</p>
      <ul>
        {workspaces.map((w) => (
          <li key={w.id}>
            <button
              type="button"
              onClick={w.active ? undefined : () => void choose(w.id)}
              disabled={busy !== null}
              aria-current={w.active ? "true" : undefined}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-ink hover:bg-sand-50 disabled:opacity-60 max-sm:min-h-11"
            >
              <span className="min-w-0 flex-1 truncate">{w.name}</span>
              {w.active && (
                <span className="shrink-0 text-xs font-semibold text-brand-700">
                  <span aria-hidden="true">✓</span>
                  <span className="sr-only">{labels.current}</span>
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>
      {failed && (
        <p role="alert" className="px-3 py-2 text-xs leading-relaxed text-red-700">
          {labels.failed}
        </p>
      )}
    </div>
  );
}
