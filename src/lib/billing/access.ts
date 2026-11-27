import "server-only";
import { anyRowRuns, lockReasonOf, reasonFromRows, type BillingRow, type LockReason } from "@/domain/billing/trial";
import type { Workspace } from "@/lib/workspace";
import { authedClient, type Session } from "@/lib/supabase/server";
import { previewEmpty } from "@/lib/deployment";
import { billingProvider, exemptOrgs } from "./provider";
import { snapshotRuns, type BillingSnapshot } from "./service";
import { cachedSnapshot, freshSnapshot, within } from "./cache";

/**
 * Who may enter a workspace (owner's decision, November 2026; the iPhone
 * app's src/lib/access.ts): a running subscription, and nobody else.
 *
 *  1. A deployment without a Stripe key, a workspace that never pays, a
 *     sample cabinet or the empty preview: open, and nothing about
 *     subscriptions shows (CI runs this way).
 *  2. The shared record (gestion.billing_status, read under the user's own
 *     token): a running row of either store opens. This is how a landlord
 *     who subscribed in the iPhone app enters the web.
 *  3. No running row: Stripe is asked, the cached snapshot then a fresh read,
 *     because the webhook can trail a Checkout by a few seconds (or not be
 *     installed yet). Stripe says it runs: open. Stripe says it does not, or
 *     does not answer: locked. There is no "in doubt, let it through".
 *
 * Every write route asks the same question (./gate.ts refuseWhenLocked).
 */
export interface AccessAnswer {
  access: "open" | "locked";
  reason: LockReason | null;
  /** Subscriptions are taken on this deployment. */
  configured: boolean;
  /** A new Checkout would come with the free days (the workspace never had a subscription). */
  trialOffered: boolean;
  /** The Stripe snapshot read on the way, when one was. */
  snapshot: BillingSnapshot | null;
}

export interface AccessDeps {
  env: Record<string, string | undefined>;
  /** Unix seconds. */
  now: number;
  /** The sample cabinet or the empty preview is on screen: there is nothing to pay for. */
  sample: boolean;
  rows: (orgId: string) => Promise<BillingRow[]>;
  cached: (orgId: string) => Promise<BillingSnapshot | null>;
  fresh: (orgId: string) => Promise<BillingSnapshot | null>;
}

const OPEN_UNCONFIGURED: AccessAnswer = { access: "open", reason: null, configured: false, trialOffered: false, snapshot: null };

/** The table is not on this project yet: no subscription was recorded for anybody. */
const MISSING_TABLE = new Set(["42P01", "PGRST205", "PGRST106"]);

const log = (what: string, error: unknown) => console.error(`billing access: ${what}:`, error instanceof Error ? error.message.slice(0, 160) : "unknown");

export async function decideAccess(orgId: string, deps: AccessDeps): Promise<AccessAnswer> {
  if (!billingProvider(deps.env).configured) return OPEN_UNCONFIGURED;
  if (deps.sample || exemptOrgs(deps.env).has(orgId.toLowerCase())) return { access: "open", reason: null, configured: true, trialOffered: false, snapshot: null };

  let rows: BillingRow[] = [];
  try {
    rows = await within(deps.rows(orgId), 4000);
  } catch (error) {
    // Unread is not "no subscription": Stripe decides below.
    log("record unread", error);
  }
  const stripeRecorded = rows.some((r) => r.source === "stripe");
  if (anyRowRuns(rows, deps.now)) return { access: "open", reason: null, configured: true, trialOffered: false, snapshot: null };

  const offered = (snapshot: BillingSnapshot | null) => !(snapshot?.everSubscribed ?? false) && !stripeRecorded;
  const open = (snapshot: BillingSnapshot): AccessAnswer => ({ access: "open", reason: null, configured: true, trialOffered: false, snapshot });
  const locked = (snapshot: BillingSnapshot | null, reason: LockReason): AccessAnswer => ({ access: "locked", reason, configured: true, trialOffered: offered(snapshot), snapshot });
  // Stripe's own answer when it has one; else what the record says.
  const reasonOf = (snapshot: BillingSnapshot | null): LockReason => (snapshot ? lockReasonOf(snapshot.subscription?.status) ?? "ended" : reasonFromRows(rows));

  let cached: BillingSnapshot | null = null;
  let cachedAnswered = false;
  try {
    cached = await within(deps.cached(orgId), 4000);
    cachedAnswered = true;
    if (snapshotRuns(cached)) return open(cached!);
    // No customer at all: that answer was not cached, it is already Stripe's current word.
    if (cached === null) return locked(null, reasonFromRows(rows));
  } catch (error) {
    log("cached read failed", error);
  }
  try {
    const current = await within(deps.fresh(orgId), 4000);
    if (snapshotRuns(current)) return open(current!);
    return locked(current, reasonOf(current));
  } catch (error) {
    log("Stripe unreachable, locked", error);
    return locked(cached, cachedAnswered ? reasonOf(cached) : reasonFromRows(rows));
  }
}

/** The `gestion` schema under the member's own token. */
type Gestion = ReturnType<ReturnType<typeof authedClient>["schema"]>;

/** The workspace's rows of the shared record, read under the member's own token (RLS lets a member read them). */
export async function recordedRows(g: Gestion, orgId: string): Promise<BillingRow[]> {
  const { data, error } = await g.from("billing_status").select("source,status,current_period_end").eq("org_id", orgId);
  if (error) {
    if (MISSING_TABLE.has(String(error.code))) return [];
    throw new Error(`billing_status read failed: ${error.code}`);
  }
  return (Array.isArray(data) ? data : []).map((r) => ({ source: String(r.source), status: String(r.status), current_period_end: r.current_period_end === null ? null : String(r.current_period_end) }));
}

/** The answer for the signed-in member's workspace, on this deployment. */
export async function accessFor(org: Pick<Workspace, "id">, session: Pick<Session, "accessToken" | "email"> | null, options: { sample?: boolean; env?: Record<string, string | undefined>; now?: number } = {}): Promise<AccessAnswer> {
  const env = options.env ?? process.env;
  if (!billingProvider(env).configured) return OPEN_UNCONFIGURED;
  // No session to read the record with (the preview harness): nothing to pay for.
  if (!session || previewEmpty()) return { ...OPEN_UNCONFIGURED, configured: true };
  return decideAccess(org.id, {
    env,
    now: options.now ?? Math.floor(Date.now() / 1000),
    sample: options.sample ?? false,
    rows: (orgId) => recordedRows(authedClient(session.accessToken).schema("gestion"), orgId),
    cached: (orgId) => cachedSnapshot(orgId, session.email),
    fresh: (orgId) => freshSnapshot(orgId, session.email),
  });
}
