import "server-only";
import { createHash, randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { OrgContext } from "@/lib/gestion/api";
import { MEDIA_BUCKET } from "@/lib/gestion/media";
import { DOCUMENT_TYPES, MAX_DOCUMENT_BYTES, RELATED_TABLES, documentName, retentionFor, type DocumentClass } from "@/lib/gestion/documents-rules";
import { todayISO } from "@/lib/clock";

/**
 * A piece of the workspace, stored: the file goes into the private bucket
 * under the workspace's own folder, and its row into `documents` with the
 * file's fingerprint, size and type. Both halves run under the caller's
 * token, so the bucket's policy and the table's decide; nothing is recorded
 * until the upload has actually succeeded, and a row that cannot be written
 * takes its object with it rather than leaving a file nobody can find.
 */
export interface StoredDocument {
  id: string;
  name: string;
  path: string;
  sha256: string;
  sizeBytes: number;
}

export type StoreFailure = "unsupported_type" | "too_large" | "upload_failed" | "storage_failed";

export interface StoreInput {
  file: File;
  klass: DocumentClass;
  name?: string;
  relatedType?: string | null;
  relatedId?: string | null;
  /** A piece of a tenancy the desk puts in front of its tenants. Not shared unless said. */
  shared?: boolean;
}

type InsertResult = { data: { id: unknown } | null; error: { code?: string; message?: string } | null };

/**
 * The register's row for a piece. `shared_with_tenant` (0031) says whether
 * the tenants of the lease it hangs off may read it; a base that does not
 * carry the column yet takes the same row without it, where every piece of
 * a lease is still the tenant's to read.
 */
async function insertDocumentRow(ctx: OrgContext, row: Record<string, unknown>): Promise<InsertResult> {
  const first = (await ctx.g.from("documents").insert(row).select("id").single()) as InsertResult;
  if (first.error && (first.error.code === "PGRST204" || first.error.code === "42703") && "shared_with_tenant" in row) {
    const { shared_with_tenant: _dropped, ...rest } = row;
    void _dropped;
    return (await ctx.g.from("documents").insert(rest).select("id").single()) as InsertResult;
  }
  return first;
}

/**
 * When a piece's retention clock runs out, as far as the day it was filed
 * says: ten years from then for the accounting classes, three months for an
 * applicant's papers. The other clocks start from an event the upload does
 * not know (the end of the relationship) or never run out, and stay open.
 */
export function retentionUntil(retention: string, filedOn: string): string | null {
  const [y, m, d] = filedOn.split("-").map(Number);
  if (!y || !m || !d) return null;
  const iso = (date: Date): string => date.toISOString().slice(0, 10);
  if (retention === "accounting_10y") return iso(new Date(Date.UTC(y + 10, m - 1, d)));
  if (retention === "applicant_3m") return iso(new Date(Date.UTC(y, m - 1 + 3, d)));
  return null;
}

/** The folder a cabinet's pieces live in: its own, which the bucket policy reads. */
export const documentFolder = (orgId: string): string => `${orgId}/documents`;

export async function storeDocument(ctx: OrgContext, client: SupabaseClient, input: StoreInput): Promise<StoredDocument | { error: StoreFailure }> {
  const ext = DOCUMENT_TYPES[input.file.type];
  if (!ext) return { error: "unsupported_type" };
  if (input.file.size > MAX_DOCUMENT_BYTES) return { error: "too_large" };

  const bytes = Buffer.from(await input.file.arrayBuffer());
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const path = `${documentFolder(ctx.org.id)}/${randomUUID()}.${ext}`;
  const { error: upErr } = await client.storage.from(MEDIA_BUCKET).upload(path, bytes, { contentType: input.file.type, upsert: false });
  if (upErr) {
    console.error("document upload failed:", upErr.message);
    return { error: "upload_failed" };
  }

  const name = documentName(input.name ?? "", input.file.name || `document.${ext}`);
  const retention = retentionFor(input.klass);
  const { data, error } = await insertDocumentRow(ctx, {
    org_id: ctx.org.id,
    class: input.klass,
    retention_class: retention,
    // The day the clock runs out, where the day of filing decides it: the purge view reads this.
    retention_until: retentionUntil(retention, todayISO()),
    name,
    storage_path: path,
    mime: input.file.type,
    size_bytes: bytes.length,
    sha256,
    related_type: input.relatedType ?? null,
    related_id: input.relatedId ?? null,
    uploaded_by: ctx.userId,
    // Only a piece of a tenancy can be shared with its tenants, and only when the desk says so.
    shared_with_tenant: input.relatedType === "lease" && input.shared === true,
  });
  if (error || !data) {
    console.error("document insert failed:", error?.code, error?.message);
    await client.storage.from(MEDIA_BUCKET).remove([path]).catch(() => null);
    return { error: "storage_failed" };
  }
  return { id: String(data.id), name, path, sha256, sizeBytes: bytes.length };
}

/**
 * A piece the application produced itself: the bytes go into the same
 * folder, the row is sealed from the start (its fingerprint is the seal),
 * and both halves run under the caller's token like an upload.
 */
export interface StoreBytesInput {
  bytes: Buffer;
  mime: string;
  klass: DocumentClass;
  name: string;
  relatedType: string | null;
  relatedId: string | null;
  sealed: boolean;
  /**
   * Whether the tenants of the lease it hangs off may read it. A piece the
   * application produces for a tenancy is theirs unless said otherwise (a
   * formal reminder before it is sent, a signature's proof journal).
   */
  shared?: boolean;
}

export async function storeBytes(ctx: OrgContext, client: SupabaseClient, input: StoreBytesInput): Promise<StoredDocument | { error: StoreFailure }> {
  const ext = DOCUMENT_TYPES[input.mime];
  if (!ext) return { error: "unsupported_type" };
  if (input.bytes.length > MAX_DOCUMENT_BYTES) return { error: "too_large" };
  const sha256 = createHash("sha256").update(input.bytes).digest("hex");
  const path = `${documentFolder(ctx.org.id)}/${randomUUID()}.${ext}`;
  const { error: upErr } = await client.storage.from(MEDIA_BUCKET).upload(path, input.bytes, { contentType: input.mime, upsert: false });
  if (upErr) {
    console.error("document upload failed:", upErr.message);
    return { error: "upload_failed" };
  }
  const name = documentName(input.name, `document.${ext}`);
  const { data, error } = await insertDocumentRow(ctx, {
    org_id: ctx.org.id,
    class: input.klass,
    retention_class: retentionFor(input.klass),
    name,
    storage_path: path,
    mime: input.mime,
    size_bytes: input.bytes.length,
    sha256,
    sealed: input.sealed,
    related_type: input.relatedType,
    related_id: input.relatedId,
    uploaded_by: ctx.userId,
    shared_with_tenant: input.relatedType === "lease" && input.shared !== false,
  });
  if (error || !data) {
    console.error("document insert failed:", error?.code, error?.message);
    await client.storage.from(MEDIA_BUCKET).remove([path]).catch(() => null);
    return { error: "storage_failed" };
  }
  return { id: String(data.id), name, path, sha256, sizeBytes: input.bytes.length };
}

/** Best effort: a piece stored for a record that was refused goes with it. */
export async function discardDocument(ctx: OrgContext, client: SupabaseClient, doc: { id: string; path: string }): Promise<void> {
  await ctx.g.from("documents").delete().eq("org_id", ctx.org.id).eq("id", doc.id);
  await client.storage.from(MEDIA_BUCKET).remove([doc.path]).catch(() => null);
}

/**
 * Whether the record a piece is to hang off exists in this workspace. Null
 * when the type is not one a piece may hang off at all.
 */
export async function relatedExists(ctx: OrgContext, relatedType: string, relatedId: string): Promise<boolean | null> {
  const table = RELATED_TABLES[relatedType];
  if (!table) return null;
  const { data, error } = await ctx.g.from(table).select("id").eq("org_id", ctx.org.id).eq("id", relatedId).maybeSingle();
  if (error) {
    console.error(`related ${relatedType} lookup failed:`, error.code, error.message);
    return false;
  }
  return Boolean(data);
}

/** A piece of this workspace hanging off the given record, or null. */
export async function ownedDocument(ctx: OrgContext, documentId: string, related: { type: string; id: string }): Promise<{ id: string; name: string } | null> {
  const { data, error } = await ctx.g
    .from("documents")
    .select("id,name,related_type,related_id")
    .eq("org_id", ctx.org.id)
    .eq("id", documentId)
    .maybeSingle();
  if (error || !data) return null;
  if (String(data.related_type) !== related.type || String(data.related_id) !== related.id) return null;
  return { id: String(data.id), name: String(data.name) };
}

const SIGNED_TTL_SECONDS = 60;

/**
 * A short-lived link to the file, for the account that may read it. Named
 * as the register names it and offered as a download, unless the file is
 * to be shown in the tab (`inline`: a phone, where a download disappears
 * into a folder and the tab is the reader).
 */
export async function signedDocumentUrl(client: SupabaseClient, storagePath: string, name: string, inline = false): Promise<string | null> {
  const { data, error } = await client.storage.from(MEDIA_BUCKET).createSignedUrl(storagePath, SIGNED_TTL_SECONDS, inline ? undefined : { download: name });
  if (error || !data?.signedUrl) {
    console.error("document signing failed:", error?.message);
    return null;
  }
  return data.signedUrl;
}

/**
 * Whether a piece of a tenancy is in front of its tenants. The piece must
 * be the workspace's and hang off a lease; anything else has no tenant to
 * be shared with. Answers the state now in force.
 */
export async function shareDocument(ctx: OrgContext, documentId: string, shared: boolean): Promise<{ shared: boolean } | { error: "not_found" | "schema_outdated" | "forbidden" | "storage_failed" }> {
  const { data: doc, error: readErr } = await ctx.g.from("documents").select("id,related_type,related_id").eq("org_id", ctx.org.id).eq("id", documentId).maybeSingle();
  if (readErr) {
    console.error("document lookup for sharing failed:", readErr.code, readErr.message);
    return { error: "storage_failed" };
  }
  if (!doc || String(doc.related_type) !== "lease" || !doc.related_id) return { error: "not_found" };
  const { data, error } = await ctx.g.from("documents").update({ shared_with_tenant: shared }).eq("org_id", ctx.org.id).eq("id", documentId).select("id");
  if (error) {
    if (error.code === "PGRST204" || error.code === "42703") return { error: "schema_outdated" };
    if (error.code === "42501") return { error: "forbidden" };
    console.error("document sharing failed:", error.code, error.message);
    return { error: "storage_failed" };
  }
  if (((data as unknown[] | null) ?? []).length === 0) return { error: "forbidden" };
  return { shared };
}

const EXTENSION_TYPE: Record<string, string> = Object.fromEntries(Object.entries(DOCUMENT_TYPES).map(([mime, ext]) => [ext, mime]));
const UPLOADED_NAME = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.([a-z0-9]{2,5})$/;

/**
 * Where a large file will go, and the short-lived permission to put it
 * there. A request to the application carries a few megabytes at most (the
 * host refuses a larger body before any route runs), so a file over that
 * goes from the browser straight to the private bucket: this hands out the
 * path, in the workspace's own folder, and a one-time upload token signed
 * under the caller's token, so the bucket's policy has already decided.
 * Nothing is registered yet: `registerUploaded` does that once the file is there.
 */
export async function signedUploadTarget(
  ctx: OrgContext,
  client: SupabaseClient,
  file: { type: string; size: number },
): Promise<{ path: string; token: string } | { error: StoreFailure }> {
  const ext = DOCUMENT_TYPES[file.type];
  if (!ext) return { error: "unsupported_type" };
  if (!(file.size > 0) || file.size > MAX_DOCUMENT_BYTES) return { error: "too_large" };
  const path = `${documentFolder(ctx.org.id)}/${randomUUID()}.${ext}`;
  const { data, error } = await client.storage.from(MEDIA_BUCKET).createSignedUploadUrl(path);
  if (error || !data?.token) {
    console.error("document upload signing failed:", error?.message);
    return { error: "upload_failed" };
  }
  return { path, token: data.token };
}

/**
 * The register's row for a file the browser put in the bucket itself. The
 * path must be one this workspace was handed (its own documents folder, a
 * generated name); the file is read back under the caller's token, so its
 * size and fingerprint are the stored object's own, never what a browser
 * said. A file that is not there, is too large, or whose row cannot be
 * written is removed rather than left where nobody can find it.
 */
export async function registerUploaded(
  ctx: OrgContext,
  client: SupabaseClient,
  input: { path: string; klass: DocumentClass; name: string; relatedType?: string | null; relatedId?: string | null; shared?: boolean },
): Promise<StoredDocument | { error: StoreFailure | "invalid" }> {
  const folder = `${documentFolder(ctx.org.id)}/`;
  const tail = input.path.startsWith(folder) ? input.path.slice(folder.length) : "";
  const mime = EXTENSION_TYPE[UPLOADED_NAME.exec(tail)?.[1] ?? ""];
  if (!mime) return { error: "invalid" };
  const storage = client.storage.from(MEDIA_BUCKET);
  // A path already on a row is somebody's piece: it is not registered twice, nor removed.
  const { data: taken } = await ctx.g.from("documents").select("id").eq("org_id", ctx.org.id).eq("storage_path", input.path).limit(1);
  if (((taken as unknown[] | null) ?? []).length > 0) return { error: "invalid" };
  const { data: blob, error: readErr } = await storage.download(input.path);
  if (readErr || !blob) {
    console.error("uploaded document read failed:", readErr?.message);
    return { error: "upload_failed" };
  }
  const bytes = Buffer.from(await blob.arrayBuffer());
  if (bytes.length === 0 || bytes.length > MAX_DOCUMENT_BYTES) {
    await storage.remove([input.path]).catch(() => null);
    return { error: "too_large" };
  }
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const name = documentName(input.name, `document.${DOCUMENT_TYPES[mime]}`);
  const retention = retentionFor(input.klass);
  const { data, error } = await insertDocumentRow(ctx, {
    org_id: ctx.org.id,
    class: input.klass,
    retention_class: retention,
    retention_until: retentionUntil(retention, todayISO()),
    name,
    storage_path: input.path,
    mime,
    size_bytes: bytes.length,
    sha256,
    related_type: input.relatedType ?? null,
    related_id: input.relatedId ?? null,
    uploaded_by: ctx.userId,
    shared_with_tenant: input.relatedType === "lease" && input.shared === true,
  });
  if (error || !data) {
    console.error("document insert failed:", error?.code, error?.message);
    await storage.remove([input.path]).catch(() => null);
    return { error: "storage_failed" };
  }
  return { id: String(data.id), name, path: input.path, sha256, sizeBytes: bytes.length };
}

export type HousekeepingFailure = "not_found" | "sealed" | "produced" | "in_use" | "invalid" | "forbidden" | "storage_failed";

/** The records that name a piece by its id, outside the register's own row. */
const REFERENCES: Array<{ table: string; column: string }> = [
  { table: "work_orders", column: "invoice_document_id" },
  { table: "deposit_deductions", column: "justification_document_id" },
  { table: "bills", column: "document_id" },
];

async function pieceOf(ctx: OrgContext, documentId: string): Promise<{ id: string; sealed: boolean; path: string; createdAt: string } | { error: HousekeepingFailure }> {
  const { data, error } = await ctx.g.from("documents").select("id,sealed,storage_path,created_at").eq("org_id", ctx.org.id).eq("id", documentId).maybeSingle();
  if (error) {
    console.error("document lookup failed:", error.code, error.message);
    return { error: "storage_failed" };
  }
  if (!data) return { error: "not_found" };
  return { id: String(data.id), sealed: data.sealed === true, path: String(data.storage_path ?? ""), createdAt: String(data.created_at ?? "").slice(0, 10) };
}

/**
 * A piece filed by mistake, taken out of the register with its file. Only
 * a piece the desk filed itself and nothing else stands on: never a sealed
 * piece, never one the application produced, never one a work order, a
 * guarantee retention or a bill names.
 */
export async function removeDocument(ctx: OrgContext, client: SupabaseClient, documentId: string): Promise<{ removed: true } | { error: HousekeepingFailure }> {
  const piece = await pieceOf(ctx, documentId);
  if ("error" in piece) return piece;
  if (piece.sealed) return { error: "sealed" };
  const { data: produced, error: genErr } = await ctx.g.from("generated_documents").select("document_id").eq("org_id", ctx.org.id).eq("document_id", piece.id).limit(1);
  // A base without the produced register (before 0022) has produced nothing.
  if (genErr && genErr.code !== "42P01" && genErr.code !== "PGRST205") return { error: "storage_failed" };
  if (((produced as unknown[] | null) ?? []).length > 0) return { error: "produced" };
  for (const ref of REFERENCES) {
    const { data: used, error: refErr } = await ctx.g.from(ref.table).select("id").eq("org_id", ctx.org.id).eq(ref.column, piece.id).limit(1);
    if (refErr) {
      console.error(`document reference read failed (${ref.table}):`, refErr.code, refErr.message);
      return { error: "storage_failed" };
    }
    if (((used as unknown[] | null) ?? []).length > 0) return { error: "in_use" };
  }
  const { data: gone, error } = await ctx.g.from("documents").delete().eq("org_id", ctx.org.id).eq("id", piece.id).eq("sealed", false).select("id");
  if (error) {
    if (error.code === "42501") return { error: "forbidden" };
    console.error("document removal failed:", error.code, error.message);
    return { error: "storage_failed" };
  }
  if (((gone as unknown[] | null) ?? []).length === 0) return { error: "forbidden" };
  if (piece.path) await client.storage.from(MEDIA_BUCKET).remove([piece.path]).catch(() => null);
  return { removed: true };
}

/**
 * A piece renamed, or put on the shelf it belongs to. The class carries its
 * retention clock, so both follow; a sealed piece keeps its class (the seal
 * covers it) and may only be renamed.
 */
export async function reclassDocument(
  ctx: OrgContext,
  documentId: string,
  input: { name?: string; klass?: DocumentClass },
): Promise<{ id: string; name: string | null; klass: DocumentClass | null } | { error: HousekeepingFailure }> {
  const piece = await pieceOf(ctx, documentId);
  if ("error" in piece) return piece;
  const patch: Record<string, unknown> = {};
  if (input.name !== undefined) {
    const name = documentName(input.name, "");
    if (!name) return { error: "invalid" };
    patch.name = name;
  }
  if (input.klass !== undefined) {
    if (piece.sealed) return { error: "sealed" };
    const retention = retentionFor(input.klass);
    patch.class = input.klass;
    patch.retention_class = retention;
    patch.retention_until = retentionUntil(retention, piece.createdAt || todayISO());
  }
  if (Object.keys(patch).length === 0) return { error: "invalid" };
  const { data, error } = await ctx.g.from("documents").update(patch).eq("org_id", ctx.org.id).eq("id", piece.id).select("id");
  if (error) {
    if (error.code === "42501") return { error: piece.sealed ? "sealed" : "forbidden" };
    console.error("document update failed:", error.code, error.message);
    return { error: "storage_failed" };
  }
  if (((data as unknown[] | null) ?? []).length === 0) return { error: "forbidden" };
  return { id: piece.id, name: (patch.name as string | undefined) ?? null, klass: input.klass ?? null };
}
