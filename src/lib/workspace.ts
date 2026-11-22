import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { authedClient, getSession, type Session } from "@/lib/supabase/server";
import { WORKSPACE_COOKIE } from "@/lib/workspace-cookie";

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
  /**
   * Set when the memberships could not be read: "no workspace" is then
   * unknown, not a fact, and nothing may be created on the strength of it.
   */
  membershipUnread?: boolean;
}

/**
 * The workspace a person with several chose to work in. The cookie only
 * carries the choice: it is checked against the memberships on every
 * request, so a value naming a workspace the account does not belong to (or
 * no longer does) is ignored. Written by POST /api/espace/actif, never by a
 * script.
 */
export { WORKSPACE_COOKIE };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** "Prénom Nom", or the part of the e-mail before the @ as a last resort. */
function displayNameFrom(
  profile: { first_name: string | null; last_name: string | null } | null,
  email: string,
): string {
  const full = [profile?.first_name, profile?.last_name].filter(Boolean).join(" ").trim();
  return full !== "" ? full : email.split("@")[0];
}

/**
 * The workspace on screen: the one chosen when it is still among the
 * person's own, else the first. The order never depends on what the
 * database happens to return: by name, then the older first, then by id.
 */
export function pickActive(workspaces: readonly Workspace[], chosen: string | null | undefined): Workspace | null {
  return workspaces.find((w) => w.id === chosen) ?? workspaces[0] ?? null;
}

type Db = ReturnType<typeof authedClient>;
interface Resolved {
  /** False when a read failed: the list is then not the truth. */
  read: boolean;
  /** Active memberships, whatever they allow. */
  memberships: number;
  /** The workspaces whose management space this account may open. */
  workspaces: Workspace[];
  profile: { first_name: string | null; last_name: string | null } | null;
}

/**
 * The account's management workspaces, the database deciding one at a time
 * (`crm_has_perm`, the production function Morada Pro already uses). `fresh`
 * opts every read out of the framework's per-render memo, for the reading
 * that follows a creation.
 */
async function resolveWorkspaces(db: Db, userId: string, fresh: boolean): Promise<Resolved> {
  const signal = () => new AbortController().signal;
  const profileQuery = db.from("profiles").select("first_name, last_name").eq("id", userId);
  const memberQuery = db.from("crm_members").select("agency_id, role").eq("user_id", userId).eq("status", "active");
  const [profileRes, membershipRes] = await Promise.all([
    (fresh ? profileQuery.abortSignal(signal()) : profileQuery).maybeSingle(),
    fresh ? memberQuery.abortSignal(signal()) : memberQuery,
  ]);
  const profile = (profileRes.data as Resolved["profile"]) ?? null;
  if (membershipRes.error) {
    console.error("[workspace] memberships unreadable:", membershipRes.error.code, membershipRes.error.message);
    return { read: false, memberships: 0, workspaces: [], profile };
  }
  const memberships = membershipRes.data ?? [];
  if (memberships.length === 0) return { read: true, memberships: 0, workspaces: [], profile };

  const ids = memberships.map((m) => m.agency_id as string);
  const agencyQuery = db.from("agencies").select("id, name, kind, created_at").in("id", ids);
  const agenciesRes = await (fresh ? agencyQuery.abortSignal(signal()) : agencyQuery);
  if (agenciesRes.error) {
    console.error("[workspace] agencies unreadable:", agenciesRes.error.code, agenciesRes.error.message);
    return { read: false, memberships: memberships.length, workspaces: [], profile };
  }
  const agencies = agenciesRes.data ?? [];

  // The database decides, one workspace at a time. A check that fails is a
  // refusal for that workspace (closed, not open), and is remembered: when
  // every check failed the list is unknown rather than empty.
  let failed = 0;
  const allowed = await Promise.all(
    agencies.map(async (a) => {
      const call = db.rpc("crm_has_perm", { p_agency: a.id as string, p_key: "gestion.properties.view" });
      const { data, error } = await (fresh ? call.abortSignal(signal()) : call);
      if (error) failed += 1;
      return error ? false : data === true;
    }),
  );

  const workspaces = agencies
    .map((a, i) => ({ a, ok: allowed[i] }))
    .filter(({ ok }) => ok)
    .map(({ a }) => ({
      id: a.id as string,
      name: (a.name as string) ?? "",
      kind: (a.kind as string) ?? "manager",
      role: (memberships.find((m) => m.agency_id === a.id)?.role as string | undefined) ?? "viewer",
      created: typeof a.created_at === "string" ? a.created_at : "",
    }))
    .sort((x, y) => x.name.localeCompare(y.name) || x.created.localeCompare(y.created) || x.id.localeCompare(y.id))
    .map(({ id, name, kind, role }) => ({ id, name, kind, role }));

  return { read: !(workspaces.length === 0 && failed > 0), memberships: memberships.length, workspaces, profile };
}

/** The workspace the browser asked to work in, when it sent a well-formed one. */
async function chosenWorkspace(): Promise<string | null> {
  try {
    const value = (await cookies()).get(WORKSPACE_COOKIE)?.value ?? "";
    return UUID.test(value) ? value : null;
  } catch {
    return null;
  }
}

export const getIdentity = cache(async (): Promise<Identity | null> => {
  const session: Session | null = await getSession();
  if (!session) return null;

  const db = authedClient(session.accessToken);
  const resolved = await resolveWorkspaces(db, session.userId, false);
  const displayName = displayNameFrom(resolved.profile, session.email);
  return {
    userId: session.userId,
    email: session.email,
    displayName,
    workspaces: resolved.workspaces,
    active: pickActive(resolved.workspaces, await chosenWorkspace()),
    ...(resolved.read ? {} : { membershipUnread: true }),
  };
});

/**
 * First entry of an account that has no management space: give it one,
 * silently, so signing in always lands in the dashboard. The space is created
 * by `gestion_onboard`, the production function the ecosystem already ships:
 * one `agencies` row (private, kind owner) plus the caller as its owner in
 * `crm_members`. Named after the person; renameable later.
 *
 * "Has no management space" is asked again right before writing, with the
 * same rule as `getIdentity` (a workspace this account may manage), not
 * "has no membership": a Morada Pro member whose role opens nothing here
 * gets a space of their own, never the agency's name over empty screens.
 * Nothing is created when that question could not be answered.
 *
 * Runs as the signed-in user, never as a service role, so the database's own
 * checks apply. Two racing first requests could each create a space; the
 * function deduplicates slugs so nothing fails, and the extra empty space is
 * visible and deletable rather than silently corrupting anything.
 */
export async function provisionDefaultWorkspace(): Promise<Identity | null> {
  const session = await getSession();
  if (!session) return null;

  const db = authedClient(session.accessToken);

  // Re-check right before writing: another request may have won the race.
  const existing = await resolveWorkspaces(db, session.userId, true);
  if (!existing.read) {
    console.error("[workspace] nothing created: the memberships could not be read");
    return null;
  }
  if (existing.workspaces.length === 0) {
    const name = displayNameFrom(existing.profile, session.email);
    const { error } = await db.rpc("gestion_onboard", { p_name: name, p_kind: "owner" });
    if (error) {
      // Named in the server log so a blank first visit can be traced; the
      // message is the database's, the person is not in it.
      console.error("[workspace] gestion_onboard failed:", error.code, error.message);
      return null;
    }
  }

  // Resolve again from scratch; getIdentity() is cached per request and would
  // hand back the pre-provisioning answer. The same goes one level down: the
  // framework memoizes identical GET requests for the length of a render, so
  // a read that repeats getIdentity()'s exact query would be answered from
  // the first, still-empty result without reaching the database. A fresh
  // abort signal is the documented way to opt a request out of that.
  const resolved = existing.workspaces.length > 0 ? existing : await resolveWorkspaces(db, session.userId, true);
  if (resolved.workspaces.length === 0) {
    console.error("[workspace] no management space after provisioning");
    return null;
  }

  return {
    userId: session.userId,
    email: session.email,
    displayName: displayNameFrom(resolved.profile, session.email),
    workspaces: resolved.workspaces,
    active: pickActive(resolved.workspaces, await chosenWorkspace()),
  };
}

/**
 * Whether this account is a tenant somewhere, or null when the question
 * could not be answered. The management layout decides what to do with an
 * account that has no workspace on this: an unknown is not a "no".
 */
export async function tenantAnswer(accessToken: string): Promise<boolean | null> {
  try {
    const { data, error } = await authedClient(accessToken).schema("gestion").rpc("is_tenant");
    if (error) {
      console.error("[workspace] tenant lookup failed:", error.code, error.message);
      return null;
    }
    return data === true;
  } catch {
    return null;
  }
}

/** Recorded on the account once it has had a management space: its absence later is then a removal, not a first visit. */
export const WORKSPACE_SEEN = "workspace_seen_at";
export function hadWorkspace(metadata: Record<string, unknown> | undefined): boolean {
  const account = metadata?.morada_account as Record<string, unknown> | undefined;
  return typeof account?.[WORKSPACE_SEEN] === "string" && account[WORKSPACE_SEEN] !== "";
}
