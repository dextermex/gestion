import type { Locale } from "@/lib/i18n/config";
import { dayKey, timeOfDay } from "@/lib/portal/format";
import { formatDate } from "@/lib/types";

/**
 * What "the most recent conversation" means, said once. The loader chooses
 * the conversation it reads in full with this rule and the screen orders
 * its list with it, so the one the server read is the one the screen opens.
 * A conversation's time is its last message's own; before any message, the
 * clock its row keeps, else the day it was opened. Two conversations at the
 * same instant fall in the order of their ids, so every reader agrees.
 */
export interface DatedThread {
  id: string;
  lastMessageAt: string;
}

const instant = (iso: string): number => {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? 0 : t;
};

/** Most recent first. */
export function byMostRecent(a: DatedThread, b: DatedThread): number {
  const gap = instant(b.lastMessageAt) - instant(a.lastMessageAt);
  if (gap !== 0) return gap;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function mostRecent<T extends DatedThread>(threads: readonly T[]): T | null {
  return [...threads].sort(byMostRecent)[0] ?? null;
}

const text = (v: unknown): string => (typeof v === "string" ? v : "");

/** When a conversation last spoke: its last message, else its row's clock, else its creation. */
export function lastSpokenAt(c: { lastSentAt?: unknown; lastMessageAt?: unknown; createdAt?: unknown }): string {
  return text(c.lastSentAt) || text(c.lastMessageAt) || text(c.createdAt);
}

/** How many messages of a conversation are read at a time, newest first; the earlier ones are asked for. */
export const THREAD_PAGE = 200;

/** A message as a conversation prints it, whoever read it: the page for the one it opens on, the read route for the others. */
export interface ThreadMessage {
  id: string;
  from: string;
  kind: "tenant" | "manager" | "owner" | "artisan" | "system";
  body: string;
  at: string;
  ticketId: string | null;
}

export interface ThreadMessageLine {
  id: string;
  from: string;
  kind: ThreadMessage["kind"];
  body: string;
  /** When it was written (the stored instant): what orders the lines and names the page before them. */
  at: string;
  /** The Luxembourg day the message is filed under, in the reader's language. */
  dayLabel: string;
  /** Its hour on Luxembourg's clock. */
  timeLabel: string;
  ticketId: string | null;
}

export function threadMessageLine(m: ThreadMessage, locale: Locale): ThreadMessageLine {
  return { id: m.id, from: m.from, kind: m.kind, body: m.body, at: m.at, dayLabel: formatDate(dayKey(m.at), locale), timeLabel: timeOfDay(m.at, locale), ticketId: m.ticketId };
}

/**
 * The lines of one conversation, from every reading of it this screen holds
 * (the page's own, the ones asked for since): each message once, in the
 * order they were written. A later reading of a message replaces an earlier one.
 */
export function mergeLines<T extends { id: string; at: string }>(...readings: ReadonlyArray<readonly T[]>): T[] {
  const byId = new Map<string, T>();
  for (const reading of readings) for (const line of reading) byId.set(line.id, line);
  return [...byId.values()].sort((a, b) => instant(a.at) - instant(b.at) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * What a shell knows of the conversations, in one line: how many messages
 * wait to be read and when the last one was written. The layout prints it
 * for what it rendered and the light read route answers with the same
 * line for what the database holds now; when the two differ, something
 * arrived or was read elsewhere, and the page is read again.
 */
export function unreadSignature(unread: number, latest: string): string {
  return `${unread}|${latest ? instant(latest) : 0}`;
}

/** The latest of several moments, as written; empty when there is none. */
export function latestMoment(moments: ReadonlyArray<string | null | undefined>): string {
  let latest = "";
  for (const m of moments) if (m && (latest === "" || instant(m) > instant(latest))) latest = m;
  return latest;
}
