import { shrinkPhotos } from "@/lib/photo";

/**
 * The files a tenant may attach to one of their requests: photographs, and
 * a PDF where a document is what is asked for (an insurance certificate, a
 * letter). One vocabulary for the three places that send them (the request
 * form, the request's page, the conversation) and for the route that takes
 * them, so the limits the screen states are the ones enforced.
 *
 * A file goes up alone, in a request of its own: the host refuses a
 * request body over about 4.5 MB before the route ever runs, so five
 * photographs together would be lost without a word. A photograph is
 * brought down to upload size first; whatever is still over the limit, or
 * of another type, is refused here, by name, instead of vanishing.
 */
export const PIECE_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/avif": "avif",
  "application/pdf": "pdf",
};
/** What a file field offers: any image (a phone's own format is converted on the way), or a PDF. */
export const PIECE_ACCEPT = "image/*,application/pdf";
/** One file per request, under the host's limit on a request body. */
export const PIECE_MAX_BYTES = 4 * 1024 * 1024;
/** Files chosen at once. */
export const PIECE_MAX_AT_ONCE = 5;
/** Files a request may hold in all. */
export const PIECE_MAX_PER_REQUEST = 20;

export type PieceRefusal = "type" | "size" | "failed" | "closed" | "too_many";
export interface PieceOutcome {
  name: string;
  ok: boolean;
  reason?: PieceRefusal;
}

/** Why the route would refuse a file as it stands, or null. */
export function pieceRefusal(file: { type: string; size: number }): Extract<PieceRefusal, "type" | "size"> | null {
  if (!PIECE_TYPES[file.type]) return "type";
  if (file.size === 0 || file.size > PIECE_MAX_BYTES) return "size";
  return null;
}

/** What a piece is, in the register's classes: a photograph, the insurance certificate it was asked for, or another paper. */
export function pieceClass(mime: string, purpose: string | null): "photo" | "insurance" | "other" {
  if (purpose === "insurance") return "insurance";
  return mime.startsWith("image/") ? "photo" : "other";
}

/** A PDF is linked by its name; anything else is shown as the picture it is. */
export function isPdfName(name: string): boolean {
  return /\.pdf$/i.test(name.trim());
}

/**
 * The chosen files made ready: photographs brought down to upload size,
 * then each one either ready to send or refused by name with its reason.
 * Nothing is dropped silently, and no more than a handful go at once.
 */
export async function preparePieces(chosen: File[]): Promise<{ ready: File[]; refused: PieceOutcome[] }> {
  const shrunk = await shrinkPhotos(chosen.slice(0, PIECE_MAX_AT_ONCE));
  const ready: File[] = [];
  const refused: PieceOutcome[] = chosen.slice(PIECE_MAX_AT_ONCE).map((f) => ({ name: f.name, ok: false, reason: "too_many" as const }));
  shrunk.forEach((file, i) => {
    const reason = pieceRefusal(file);
    if (reason) refused.push({ name: chosen[i].name, ok: false, reason });
    else ready.push(file);
  });
  return { ready, refused };
}

const REASON_OF_ERROR: Record<string, PieceRefusal> = { unsupported_type: "type", too_large: "size", request_closed: "closed", too_many: "too_many" };

/**
 * Sends the files to one of the tenant's requests, one request each, and
 * says what became of every one. `signed_out` when the session is over.
 */
export async function sendPieces(requestId: string, files: File[], purpose: "insurance" | null = null): Promise<PieceOutcome[] | "signed_out"> {
  const outcomes: PieceOutcome[] = [];
  for (const file of files) {
    const body = new FormData();
    body.append("files", file);
    if (purpose) body.append("purpose", purpose);
    try {
      const res = await fetch(`/api/locataire/demandes/${encodeURIComponent(requestId)}/pieces`, { method: "POST", body });
      if (res.status === 401) return "signed_out";
      const data = (await res.json().catch(() => ({}))) as { error?: string; attached?: number };
      // 413 with no JSON: the host refused the body before the route ran.
      if (res.ok && (data.attached ?? 0) > 0) outcomes.push({ name: file.name, ok: true });
      else outcomes.push({ name: file.name, ok: false, reason: res.status === 413 ? "size" : (REASON_OF_ERROR[data.error ?? ""] ?? "failed") });
    } catch {
      outcomes.push({ name: file.name, ok: false, reason: "failed" });
    }
  }
  return outcomes;
}

export interface PieceLabels {
  badType: string;
  tooLarge: string;
  notSent: string;
  closed: string;
  tooMany: string;
}

/** One refused file, said in words: its name and why. */
export function pieceLine(outcome: PieceOutcome, labels: PieceLabels): string {
  const text = outcome.reason === "type" ? labels.badType : outcome.reason === "size" ? labels.tooLarge : outcome.reason === "closed" ? labels.closed : outcome.reason === "too_many" ? labels.tooMany : labels.notSent;
  return text.replace("{name}", outcome.name);
}
