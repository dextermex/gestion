import { NextRequest, NextResponse } from "next/server";
import { withOrg, refuseWithout } from "@/lib/gestion/api";
import { RATE, refuseOverRate } from "@/lib/gestion/rate-limit";
import { MAX_RECOGNITION_BYTES, RECOGNISABLE_TYPES } from "@/lib/gestion/documents-rules";
import { recogniseDocument, recognitionConfigured, recognitionFailure } from "@/lib/documents/recognise";
import type { RecognitionCandidate } from "@/lib/documents/recognition";
import { LOCALES, type Locale } from "@/lib/i18n/config";

/**
 * A file read before it is stored: the reader proposes a class, a title,
 * the key facts and the record the piece belongs to. Nothing is written;
 * the answer is a proposal the dialog fills in and the person confirms.
 * Off when the deployment carries no key, silent on a file the reader
 * cannot look at (a spreadsheet, an AVIF image, a file past the cap).
 */
export const runtime = "nodejs";
export const maxDuration = 60;

const str = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().slice(0, max) : "");

function candidatesOf(raw: unknown): RecognitionCandidate[] {
  if (typeof raw !== "string" || raw === "") return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((c): c is { id: unknown; label: unknown } => Boolean(c) && typeof c === "object")
      .map((c) => ({ id: str(c.id, 64), label: str(c.label, 120) }))
      .filter((c) => c.id !== "" && c.label !== "")
      .slice(0, 200);
  } catch {
    return [];
  }
}

export async function POST(req: NextRequest) {
  // A write: the reader costs money per file, so it follows the same rules
  // as storing the piece (this application's own pages, a workspace whose
  // trial has not lapsed).
  const ctx = await withOrg("write");
  if (ctx instanceof NextResponse) return ctx;
  if (!recognitionConfigured()) return NextResponse.json({ configured: false, supported: false, recognition: null });
  // Nobody reads a file they could not store: the role is asked before the reader is.
  const refused = await refuseWithout(ctx, "gestion.documents.edit");
  if (refused) return refused;
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File) || file.size === 0) return NextResponse.json({ error: "invalid" }, { status: 400 });
  if (!RECOGNISABLE_TYPES.has(file.type) || file.size > MAX_RECOGNITION_BYTES) {
    return NextResponse.json({ configured: true, supported: false, recognition: null });
  }
  // One paid call per file from here on: counted per person and per workspace, by the day.
  const limited = await refuseOverRate(ctx.g, RATE.documentRead, ctx.org.id);
  if (limited) return limited;
  const asked = str(form?.get("lang"), 2);
  const lang = (LOCALES as readonly string[]).includes(asked) ? (asked as Locale) : "fr";
  const candidates = candidatesOf(form?.get("candidates"));
  const bytes = new Uint8Array(await file.arrayBuffer());
  try {
    const recognition = await recogniseDocument({ bytes, mime: file.type, lang, candidates });
    return NextResponse.json({ configured: true, supported: true, recognition });
  } catch (e) {
    // The reason, never the document: a status and a code say enough.
    const detail = e instanceof Error ? `${e.name}: ${e.message.slice(0, 200)}` : String(e);
    console.error("document recognition failed:", detail);
    // No proposal, and why: the reader was busy, did not answer in time, or failed. The dialog works without it either way.
    return NextResponse.json({ configured: true, supported: true, recognition: null, failed: recognitionFailure(e) });
  }
}
