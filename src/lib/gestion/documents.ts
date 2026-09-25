import "server-only";
import { createHash, randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { OrgContext } from "@/lib/gestion/api";
import { MEDIA_BUCKET } from "@/lib/gestion/media";
import { DOCUMENT_TYPES, MAX_DOCUMENT_BYTES, RELATED_TABLES, documentName, retentionFor, type DocumentClass } from "@/lib/gestion/documents-rules";

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
  const { data, error } = await ctx.g
    .from("documents")
    .insert({
      org_id: ctx.org.id,
      class: input.klass,
      retention_class: retentionFor(input.klass),
      name,
      storage_path: path,
      mime: input.file.type,
      size_bytes: bytes.length,
      sha256,
      related_type: input.relatedType ?? null,
      related_id: input.relatedId ?? null,
      uploaded_by: ctx.userId,
    })
    .select("id")
    .single();
  if (error || !data) {
    console.error("document insert failed:", error?.code, error?.message);
    await client.storage.from(MEDIA_BUCKET).remove([path]).catch(() => null);
    return { error: "storage_failed" };
  }
  return { id: String(data.id), name, path, sha256, sizeBytes: bytes.length };
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

/** A short-lived link to the file, named as the register names it, for the account that may read it. */
export async function signedDocumentUrl(client: SupabaseClient, storagePath: string, name: string): Promise<string | null> {
  const { data, error } = await client.storage.from(MEDIA_BUCKET).createSignedUrl(storagePath, SIGNED_TTL_SECONDS, { download: name });
  if (error || !data?.signedUrl) {
    console.error("document signing failed:", error?.message);
    return null;
  }
  return data.signedUrl;
}
