import "server-only";
import { cache } from "react";
import { getDemo, isSampleData } from "@/lib/demo";
import { tenantSpaceFromSample } from "@/lib/demo/tenant";
import { signMedia } from "@/lib/gestion/media";
import { authedClient, getSession } from "@/lib/supabase/server";
import { getIdentity } from "@/lib/workspace";
import { buildTenantSpace, type TenantSpace } from "@/lib/portal/tenant-space";

/**
 * What the tenant pages render, resolved once per request.
 *
 * On a sample cabinet the space is the sample tenant's, read from the same
 * dataset the owner's screens show, so the two sides of the demo agree. On
 * real data it is built under the visitor's own token, and a visitor with
 * no session has nothing to see: the layout sends them to sign in.
 */
export type TenantView =
  | { kind: "sample"; space: TenantSpace; sample: true; canManage: boolean }
  | { kind: "real"; space: TenantSpace; sample: false; canManage: boolean }
  | { kind: "signed_out" };

export const getTenantView = cache(async (): Promise<TenantView> => {
  if (await isSampleData()) {
    const identity = await getIdentity();
    return { kind: "sample", space: tenantSpaceFromSample(await getDemo()), sample: true, canManage: (identity?.workspaces.length ?? 0) > 0 };
  }
  const session = await getSession();
  if (!session) return { kind: "signed_out" };
  const client = authedClient(session.accessToken);
  const identity = await getIdentity();
  const space = await buildTenantSpace(client.schema("gestion"), {
    userId: session.userId,
    email: session.email,
    displayName: identity?.displayName ?? session.email.split("@")[0],
    today: new Date().toISOString().slice(0, 10),
    sign: (paths) => signMedia(client, paths),
  });
  return { kind: "real", space, sample: false, canManage: (identity?.workspaces.length ?? 0) > 0 };
});
