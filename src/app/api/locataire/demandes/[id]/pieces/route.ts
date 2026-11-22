import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { authedClient } from "@/lib/supabase/server";
import { MEDIA_BUCKET } from "@/lib/gestion/media";
import { isTicketClosed } from "@/lib/gestion/interventions";
import { withTenant } from "@/lib/portal/session";
import { attachTenantFiles, type UploadedFile } from "@/lib/portal/requests";
import { PIECE_MAX_AT_ONCE, PIECE_MAX_PER_REQUEST, PIECE_TYPES, pieceClass, pieceRefusal, type PieceOutcome } from "@/lib/portal/pieces";
import { attachmentFolder } from "@/lib/portal/types";
import type { TicketStatus } from "@/lib/types";

/**
 * Files for one of the tenant's own requests: photographs, or a PDF where
 * a document is what is asked for. Each file goes into the lease's folder
 * of the private media bucket under the tenant's token, so the storage
 * policy decides (their lease, in force); then the documents are recorded
 * on the request, where the owner's screens list them.
 *
 * The answer says what became of every file, by name: the screens send one
 * file per request (the host refuses a larger body) and tell the tenant
 * which did not go and why. A request that is closed takes nothing more,
 * and a request holds a bounded number of files. A file whose row is
 * refused is removed again.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await withTenant();
  if (ctx instanceof NextResponse) return ctx;
  const { g, session } = ctx;
  const { id } = await params;

  const { data: ticket, error } = await g.from("tickets").select("id,org_id,lease_id,status").eq("id", id).maybeSingle();
  if (error) return NextResponse.json({ error: "storage_failed" }, { status: 502 });
  if (!ticket || !ticket.lease_id) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (isTicketClosed(String(ticket.status) as TicketStatus)) return NextResponse.json({ error: "request_closed" }, { status: 409 });
  const lease = { id: String(ticket.lease_id), orgId: String(ticket.org_id) };

  const form = await req.formData().catch(() => null);
  const files = (form?.getAll("files") ?? []).filter((f): f is File => f instanceof File).slice(0, PIECE_MAX_AT_ONCE);
  if (files.length === 0) return NextResponse.json({ error: "invalid" }, { status: 400 });
  const purpose = form?.get("purpose") === "insurance" ? "insurance" : null;

  // A request holds a bounded number of files, however many times the picker is used.
  const { data: held, error: heldErr } = await g.from("documents").select("id").eq("related_type", "ticket").eq("related_id", String(ticket.id)).limit(PIECE_MAX_PER_REQUEST + 1);
  if (heldErr) return NextResponse.json({ error: "storage_failed" }, { status: 502 });
  const room = PIECE_MAX_PER_REQUEST - ((held as unknown[] | null) ?? []).length;
  if (room <= 0) return NextResponse.json({ error: "too_many" }, { status: 409 });

  const storage = authedClient(session.accessToken).storage.from(MEDIA_BUCKET);
  const folder = attachmentFolder(lease.orgId, lease.id);
  const uploaded: Array<UploadedFile & { klass: string }> = [];
  const outcomes: PieceOutcome[] = [];
  for (const file of files) {
    const refusal = uploaded.length >= room ? "too_many" : pieceRefusal(file);
    if (refusal) {
      outcomes.push({ name: file.name, ok: false, reason: refusal });
      continue;
    }
    const path = `${folder}${randomUUID()}.${PIECE_TYPES[file.type]}`;
    const { error: upErr } = await storage.upload(path, file, { contentType: file.type, upsert: false });
    if (upErr) {
      console.error("request file upload failed:", upErr.message);
      outcomes.push({ name: file.name, ok: false, reason: "failed" });
      continue;
    }
    uploaded.push({ path, name: file.name, mime: file.type, sizeBytes: file.size, klass: pieceClass(file.type, purpose) });
    outcomes.push({ name: file.name, ok: true });
  }
  if (uploaded.length === 0) {
    const first = outcomes[0]?.reason;
    const status = first === "type" ? 415 : first === "size" ? 413 : first === "too_many" ? 409 : 502;
    const code = first === "type" ? "unsupported_type" : first === "size" ? "too_large" : first === "too_many" ? "too_many" : "upload_failed";
    return NextResponse.json({ error: code, refused: outcomes.length, outcomes }, { status });
  }

  const result = await attachTenantFiles(g, { id: session.userId }, lease, String(ticket.id), uploaded);
  if ("error" in result) {
    // The rows were refused: the files just put in the lease's folder are taken back (0031 lets the
    // tenant remove a file no piece names), so none stays where nobody would ever see it.
    await storage.remove(uploaded.map((u) => u.path)).catch(() => null);
    return NextResponse.json({ error: result.error }, { status: result.error === "forbidden" ? 403 : 502 });
  }
  return NextResponse.json({ ok: true, attached: result.attached, refused: outcomes.filter((o) => !o.ok).length, outcomes });
}
