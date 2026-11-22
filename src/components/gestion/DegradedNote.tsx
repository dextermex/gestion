import type { Dict } from "@/lib/i18n";

/**
 * Said when the figures on screen are incomplete: a read of the workspace's
 * rows failed (named in `DEGRADED` by the read model), so a total, a late
 * list or an empty screen may be short, not true. Nothing is guessed.
 */
export default function DegradedNote({ tables, d }: { tables: readonly string[]; d: Dict }) {
  if (tables.length === 0) return null;
  return (
    <p role="status" data-degraded className="mb-4 rounded-xl bg-amber-50 px-4 py-3 text-sm leading-relaxed text-amber-900">
      {tables.includes("hydration") ? d.shell.degradedAll : d.shell.degradedSome}
    </p>
  );
}
