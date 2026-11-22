import { NextRequest, NextResponse } from "next/server";
import { withOrgAndClient } from "@/lib/gestion/api";
import { signedUploadTarget } from "@/lib/gestion/documents";
import { MEDIA_BUCKET } from "@/lib/gestion/media";

/**
 * A large piece on its way to the register. A request to the application
 * carries a few megabytes at most, so a file over that goes from the
 * browser straight to the private bucket: this route answers with where
 * (the workspace's own folder) and a one-time upload token signed under the
 * caller's own token. The piece is registered afterwards, through
 * `POST /api/documents` with the path, once the file is there.
 */
export async function POST(req: NextRequest) {
  const ctx = await withOrgAndClient("write");
  if (ctx instanceof NextResponse) return ctx;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const type = typeof body.type === "string" ? body.type.slice(0, 120) : "";
  const size = typeof body.size === "number" && Number.isFinite(body.size) ? body.size : 0;
  if (!type || size <= 0) return NextResponse.json({ error: "invalid" }, { status: 400 });

  const target = await signedUploadTarget(ctx, ctx.client, { type, size });
  if ("error" in target) {
    const status = target.error === "unsupported_type" ? 415 : target.error === "too_large" ? 413 : 502;
    return NextResponse.json({ error: target.error }, { status });
  }
  return NextResponse.json({ bucket: MEDIA_BUCKET, path: target.path, token: target.token }, { status: 201 });
}
