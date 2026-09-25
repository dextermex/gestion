/**
 * What a screen asks the real loader for. Nothing here is a query: it is
 * the shape of the question, so the loader can filter and page on the
 * server instead of reading a workspace whole. A page that asks nothing
 * gets the bounded default: the portfolio, the last two years of history,
 * the first page of every list.
 */
export interface PageRequest {
  page: number;
  size: number;
}

export interface PageInfo extends PageRequest {
  total: number;
  pages: number;
}

export interface ReadScope {
  /**
   * The shell alone: the portfolio, the contacts, the tenancies and their
   * parties (the search palette, the pickers), the unread and review
   * badges, and whether a first rent was ever received. No history.
   */
  shell?: boolean;
  /** One tenancy: its periods, guarantee, letters, inventories, tickets, threads, pieces. */
  leaseId?: string;
  /** One property: its lots and their tenancies. */
  propertyId?: string;
  /** The thread whose messages are wanted in full; "latest" for the most recent one. */
  conversationId?: string | "latest";
  /** How far back the history tables reach (rent periods, bank operations, tickets, readings). */
  monthsBack?: number;
  documents?: PageRequest;
  /** The journal's last entries (the settings screen only). */
  audit?: boolean;
}

export const DEFAULT_MONTHS_BACK = 24;
export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 200;

/** A page as the address names it: `?page=2&taille=50`, bounded, never a fraction. */
export function pageRequest(params: { page?: string; taille?: string } | undefined, size = DEFAULT_PAGE_SIZE): PageRequest {
  const page = Math.max(1, Math.floor(Number(params?.page) || 1));
  const asked = Math.floor(Number(params?.taille) || size);
  return { page, size: Math.min(MAX_PAGE_SIZE, Math.max(1, asked)) };
}

export function pageInfo(req: PageRequest, total: number): PageInfo {
  return { ...req, total, pages: Math.max(1, Math.ceil(total / req.size)) };
}

/** The first day of the month `monthsBack` months before `today`. */
export function windowStart(today: string, monthsBack: number = DEFAULT_MONTHS_BACK): string {
  const [y, m] = today.slice(0, 7).split("-").map(Number);
  const index = y * 12 + (m - 1) - Math.max(0, monthsBack);
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}-01`;
}

/** The offsets PostgREST's range takes: zero-based, inclusive. */
export function pageBounds(req: PageRequest): { from: number; to: number } {
  return { from: (req.page - 1) * req.size, to: req.page * req.size - 1 };
}
