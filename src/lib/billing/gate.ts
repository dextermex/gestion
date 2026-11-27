import "server-only";
import { NextResponse } from "next/server";
import type { Workspace } from "@/lib/workspace";
import { getSession } from "@/lib/supabase/server";
import { accessFor, type AccessAnswer } from "./access";

/**
 * Whether a workspace's writes are refused: the same answer as the pages
 * (./access.ts). A locked workspace changes nothing; subscribing, the portal
 * and the account's own routes are not writes to it and stay open.
 */
export async function lockedFor(org: Pick<Workspace, "id">, answer: (org: Pick<Workspace, "id">) => Promise<AccessAnswer> = async (o) => accessFor(o, await getSession())): Promise<boolean> {
  return (await answer(org)).access === "locked";
}

/** The answer a refused write gets: the client reloads the page, which then shows the locked screen. */
export async function refuseWhenLocked(org: Workspace): Promise<NextResponse | null> {
  return (await lockedFor(org)) ? NextResponse.json({ error: "subscription_required" }, { status: 402 }) : null;
}
