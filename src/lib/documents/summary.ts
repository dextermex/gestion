import { addDays } from "@/domain/dates";
import { DOCUMENT_GROUP_KEYS, groupOf, type DocumentGroup } from "@/lib/gestion/documents-rules";
import type { DocumentFilter } from "@/lib/demo/scope";

/**
 * What the register says about itself at a glance, and how a filter reads
 * over a register held whole (the sample cabinets). The real loader
 * filters on the server and builds the same summary from one light read;
 * the figures are computed here either way, never in a page.
 */
export const PURGE_HORIZON_DAYS = 90;
export const RECENT_DAYS = 30;

export interface DocumentFacts {
  klass: string;
  sealed: boolean;
  retentionUntil: string | null;
  createdAt: string;
  kind?: string | null;
}

export interface DocumentSummary {
  total: number;
  sealed: number;
  /** Pieces filed under "other": the shelf to come back to. */
  unfiled: number;
  /** Pieces whose retention ends within the horizon, or already ended. */
  purgeDue: number;
  nextPurge: string | null;
  /** Pieces the application produced itself. */
  generated: number;
  /** Pieces added in the last RECENT_DAYS days. */
  recent: number;
  lastAdded: string | null;
  byGroup: Record<DocumentGroup, number>;
}

/** The last day of the purge horizon, from a given day. */
export function purgeHorizon(today: string): string {
  return addDays(today, PURGE_HORIZON_DAYS);
}

export function summariseDocuments(docs: readonly DocumentFacts[], today: string, total = docs.length): DocumentSummary {
  const horizon = purgeHorizon(today);
  const since = addDays(today, -RECENT_DAYS);
  const byGroup = Object.fromEntries(DOCUMENT_GROUP_KEYS.map((g) => [g, 0])) as Record<DocumentGroup, number>;
  let sealed = 0;
  let unfiled = 0;
  let purgeDue = 0;
  let nextPurge: string | null = null;
  let generated = 0;
  let recent = 0;
  let lastAdded: string | null = null;
  for (const doc of docs) {
    byGroup[groupOf(doc.klass)] += 1;
    if (doc.sealed) sealed += 1;
    if (doc.klass === "other") unfiled += 1;
    if (doc.kind) generated += 1;
    if (doc.retentionUntil && doc.retentionUntil <= horizon) {
      purgeDue += 1;
      if (nextPurge === null || doc.retentionUntil < nextPurge) nextPurge = doc.retentionUntil;
    }
    if (doc.createdAt >= since) recent += 1;
    if (lastAdded === null || doc.createdAt > lastAdded) lastAdded = doc.createdAt;
  }
  return { total, sealed, unfiled, purgeDue, nextPurge, generated, recent, lastAdded, byGroup };
}

/** Letters and digits only, lower-cased, accents folded: what a search compares. */
export function foldText(v: string): string {
  return v.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

/**
 * The words of a search box, as both loaders take them: at most five,
 * each bounded, without the characters a filter grammar would read
 * (wildcards, quotes, separators).
 */
export function searchWords(q: string | undefined): string[] {
  if (!q) return [];
  return q
    .replace(/[%_*,.()"'\\]/g, " ")
    .split(/\s+/)
    .map((w) => w.trim().slice(0, 40))
    .filter(Boolean)
    .slice(0, 5);
}

/** A filter over a register held whole: the shelf, the words, the purge horizon. */
export function filterDocuments<T extends DocumentFacts & { name: string; relatedLabel: string }>(docs: readonly T[], filter: DocumentFilter, today: string): T[] {
  const classes = filter.classes;
  const words = (filter.words ?? []).map(foldText);
  const horizon = filter.purgeSoon ? purgeHorizon(today) : null;
  return docs.filter((doc) => {
    if (classes && !classes.includes(doc.klass)) return false;
    if (horizon && !(doc.retentionUntil && doc.retentionUntil <= horizon)) return false;
    if (words.length > 0) {
      const hay = foldText(`${doc.name} ${doc.relatedLabel}`);
      if (!words.every((w) => hay.includes(w))) return false;
    }
    return true;
  });
}
