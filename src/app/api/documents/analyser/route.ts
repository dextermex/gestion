import { NextRequest, NextResponse } from "next/server";
import { withOrg } from "@/lib/gestion/api";
import { MAX_RECOGNITION_BYTES, RECOGNISABLE_TYPES } from "@/lib/gestion/documents-rules";
import { recogniseDocument, recognitionConfigured } from "@/lib/documents/recognise";
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
  const ctx = await withOrg();
  if (ctx instanceof NextResponse) return ctx;
  if (!recognitionConfigured()) return NextResponse.json({ configured: false, supported: false, recognition: null });
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File) || file.size === 0) return NextResponse.json({ error: "invalid" }, { status: 400 });
  if (!RECOGNISABLE_TYPES.has(file.type) || file.size > MAX_RECOGNITION_BYTES) {
    return NextResponse.json({ configured: true, supported: false, recognition: null });
  }
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
    return NextResponse.json({ configured: true, supported: true, recognition: null });
  }
}
