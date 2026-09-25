import { createHash } from "node:crypto";

/**
 * The hash manifest an inventory is sealed with: every item and every photo
 * in a fixed order, hashed once. The same rows always give the same
 * manifest, so a report can be checked against the session it came from.
 */
export interface ManifestItem {
  id: string;
  room: string;
  category: string;
  condition: string;
  notes: string;
}
export interface ManifestPhoto {
  id: string;
  itemId: string;
  sha256: string;
  capturedAt: string;
}

export function sealManifest(session: { id: string; kind: string; completedAt: string | null; keyHandoverAt: string | null }, items: ManifestItem[], photos: ManifestPhoto[]): { manifest: string; sha256: string } {
  const lines = [
    `session ${session.id} ${session.kind} ${session.completedAt ?? ""} ${session.keyHandoverAt ?? ""}`,
    ...[...items].sort((a, b) => a.id.localeCompare(b.id)).map((i) => `item ${i.id} ${i.room} ${i.category} ${i.condition} ${i.notes.replace(/\s+/g, " ")}`),
    ...[...photos].sort((a, b) => a.id.localeCompare(b.id)).map((p) => `photo ${p.id} ${p.itemId} ${p.sha256} ${p.capturedAt}`),
  ];
  const manifest = lines.join("\n");
  return { manifest, sha256: createHash("sha256").update(manifest).digest("hex") };
}
