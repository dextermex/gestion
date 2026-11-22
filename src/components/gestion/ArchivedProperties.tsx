"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card } from "@/components/pro/ui";
import { Icon } from "@/components/pro/icons";

/**
 * The archived properties, each with the one thing to do with it: bring it
 * back. Restoring is the same verb the archive used (`PATCH /api/biens/[id]`),
 * and the lots come back with their property.
 */
export interface ArchivedRow {
  id: string;
  name: string;
  address: string;
  /** "Archivé le …" and the lot count, already worded for the reader. */
  meta: string;
}

export default function ArchivedProperties({
  rows,
  labels,
}: {
  rows: ArchivedRow[];
  labels: { restore: string; restoreFailed: string };
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  async function restore(id: string) {
    setBusy(id);
    setFailed(null);
    try {
      const res = await fetch(`/api/biens/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "restore" }),
      });
      if (!res.ok) {
        setFailed(id);
        return;
      }
      router.refresh();
    } catch {
      setFailed(id);
    } finally {
      setBusy(null);
    }
  }

  return (
    <ul className="space-y-3">
      {rows.map((row) => (
        <li key={row.id}>
          <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
            <div className="min-w-0">
              <p className="truncate font-display text-base font-bold text-ink">{row.name}</p>
              <p className="mt-0.5 flex items-center gap-1 truncate text-xs text-ink-soft">
                <Icon name="pin" size={13} className="shrink-0" />
                <span className="truncate">{row.address}</span>
              </p>
              <p className="mt-1 text-xs text-ink-soft">{row.meta}</p>
              {failed === row.id && (
                <p role="alert" className="mt-2 text-sm font-semibold text-red-700">
                  {labels.restoreFailed}
                </p>
              )}
            </div>
            <Button variant="secondary" loading={busy === row.id} disabled={busy !== null} onClick={() => restore(row.id)}>
              {labels.restore}
            </Button>
          </Card>
        </li>
      ))}
    </ul>
  );
}
