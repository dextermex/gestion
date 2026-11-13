import "server-only";
import { cache } from "react";
import { getDemo, isSampleData } from "@/lib/demo";
import { TENANT_LEASE_ID } from "@/lib/demo/tenant";
import { authedClient, getSession } from "@/lib/supabase/server";

/**
 * The tenant's own account, as their profile and settings pages show it:
 * the name on their profile row, the e-mail and the mobile they sign in
 * with. All of it is read under the tenant's own token: the profile row
 * through its own-row policy, the sign-in details from the account system
 * itself. Nothing of the landlord's file is here: that is the lease's
 * (`TenantSpace`), and the tenant cannot edit it.
 */
export interface TenantAccount {
  firstName: string;
  lastName: string;
  email: string;
  /** The mobile the account signs in with, in international form; null when it has none. */
  phone: string | null;
}

function splitName(full: string): { firstName: string; lastName: string } {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  return { firstName: parts[0] ?? "", lastName: parts.slice(1).join(" ") };
}

export const getTenantAccount = cache(async (fallbackName = ""): Promise<TenantAccount | null> => {
  if (await isSampleData()) {
    const demo = await getDemo();
    const lease = demo.LEASES.find((l) => l.id === TENANT_LEASE_ID);
    const contact = lease ? demo.contactById(lease.tenantContactIds[0]) : null;
    return { ...splitName(contact?.name ?? fallbackName), email: contact?.email ?? "", phone: contact?.phone ?? null };
  }
  const session = await getSession();
  if (!session) return null;
  const db = authedClient(session.accessToken);
  const [profile, auth] = await Promise.all([
    db.from("profiles").select("first_name,last_name").eq("id", session.userId).maybeSingle(),
    db.auth.getUser(session.accessToken),
  ]);
  const first = String(profile.data?.first_name ?? "").trim();
  const last = String(profile.data?.last_name ?? "").trim();
  const named = first !== "" || last !== "" ? { firstName: first, lastName: last } : splitName(fallbackName);
  const phone = auth.data.user?.phone ? `+${auth.data.user.phone.replace(/^\+/, "")}` : null;
  return { ...named, email: auth.data.user?.email ?? session.email, phone };
});
