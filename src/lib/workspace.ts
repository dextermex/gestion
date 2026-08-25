import "server-only";
import { cache } from "react";
import { authedClient, getSession, type Session } from "@/lib/supabase/server";

/**
 * Who the signed-in user is, and which workspaces they may manage.
 *
 * Everything here is resolved from the tables that already exist in the
 * Morada project: `profiles` for the name, `crm_members` for membership,
 * `agencies` for the workspace itself. No new identity, no second `profiles`,
 * and `auth.users.id` stays the only key that matters.
 *
 * Access is decided by the database, not here: `crm_has_perm` is the
 * production function Morada Pro already uses. If it cannot be reached, the
 * workspace is treated as inaccessible — failing closed rather than open.
 */

export interface Workspace {
  id: string;
  name: string;
  kind: string;
  role: string;
}

export interface Identity {
  userId: string;
  email: string;
  displayName: string;
  workspaces: Workspace[];
  active: Workspace | null;
}

/** "Prénom Nom", or the part of the e-mail before the @ as a last resort. */
function displayNameFrom(
  profile: { first_name: string | null; last_name: string | null } | null,
  email: string,
): string {
  const full = [profile?.first_name, profile?.last_name].filter(Boolean).join(" ").trim();
  return full !== "" ? full : email.split("@")[0];
}

export const getIdentity = cache(async (): Promise<Identity | null> => {
  const session: Session | null = await getSession();
  if (!session) return null;

  const db = authedClient(session.accessToken);

  const [profileRes, membershipRes] = await Promise.all([
    db.from("profiles").select("first_name, last_name").eq("id", session.userId).maybeSingle(),
    db.from("crm_members").select("agency_id, role").eq("user_id", session.userId).eq("status", "active"),
  ]);

  const memberships = membershipRes.data ?? [];
  const displayName = displayNameFrom(profileRes.data ?? null, session.email);

  if (memberships.length === 0) {
    return { userId: session.userId, email: session.email, displayName, workspaces: [], active: null };
  }

  const ids = memberships.map((m) => m.agency_id as string);
  const agenciesRes = await db.from("agencies").select("id, name, kind").in("id", ids);
  const agencies = agenciesRes.data ?? [];

  // The database decides, one workspace at a time.
  const allowed = await Promise.all(
    agencies.map(async (a) => {
      const { data, error } = await db.rpc("crm_has_perm", {
        p_agency: a.id as string,
        p_key: "gestion.properties.view",
      });
      return error ? false : data === true;
    }),
  );

  const workspaces: Workspace[] = agencies
    .map((a, i) => ({ a, ok: allowed[i] }))
    .filter(({ ok }) => ok)
    .map(({ a }) => ({
      id: a.id as string,
      name: (a.name as string) ?? "",
      kind: (a.kind as string) ?? "manager",
      role: memberships.find((m) => m.agency_id === a.id)?.role ?? "viewer",
    }))
    .sort((x, y) => x.name.localeCompare(y.name));

  return {
    userId: session.userId,
    email: session.email,
    displayName,
    workspaces,
    active: workspaces[0] ?? null,
  };
});
