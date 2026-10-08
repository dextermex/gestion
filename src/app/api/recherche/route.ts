import { NextResponse } from "next/server";
import { withOrg } from "@/lib/gestion/api";
import { getDemo } from "@/lib/demo";
import { buildSearchIndex } from "@/lib/demo/search";

/**
 * The search palette's corpus, read when the palette first opens rather
 * than carried by every page and every refresh: the same index the layout
 * used to send, built from the ACTIVE dataset (the account's own rows under
 * its own token, or the sample cabinet the sidebar chose). Read-only, for a
 * signed-in account with a workspace, and never kept by a browser or a proxy.
 */
export async function GET() {
  const ctx = await withOrg("read");
  if (ctx instanceof NextResponse) return ctx;
  const demo = await getDemo({ shell: true });
  return NextResponse.json(buildSearchIndex(demo), { headers: { "Cache-Control": "private, no-store" } });
}
