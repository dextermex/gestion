import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { after } from "next/server";
import GestionShell from "@/components/gestion/Shell";
import UnreadWatch from "@/components/gestion/UnreadWatch";
import SessionKeeper from "@/components/gestion/SessionKeeper";
import ProvisionError from "@/components/gestion/ProvisionError";
import { ApiErrorsProvider } from "@/components/gestion/ApiErrors";
import NoWorkspace from "@/components/gestion/NoWorkspace";
import { getI18n } from "@/lib/i18n";
import { getDatasetId, getDemo } from "@/lib/demo";
import { previewEmpty } from "@/lib/deployment";
import { WORKSPACE_SEEN, getIdentity, hadWorkspace, provisionDefaultWorkspace, tenantAnswer } from "@/lib/workspace";
import { authedClient, getSession } from "@/lib/supabase/server";
import { updateSignupUser } from "@/lib/signup/update-user";
import { REQUESTED_PATH_HEADER, signInAddress } from "@/lib/auth/return-path";
import { TRIAL_DAYS, billedRents } from "@/domain/billing/pricing";
import { shellBillingOf, visitSnapshot, canManageBilling } from "@/lib/billing/view";
import { accessFor } from "@/lib/billing/access";
import Locked from "@/components/gestion/Locked";
import { resumeStep } from "@/lib/signup/model";
import { offerSchema } from "@/lib/signup/offer";
import { quickLeaseOptions } from "@/lib/gestion/quick-lease";
import { paymentLeases } from "@/lib/gestion/ledger";
import { latestMoment, unreadSignature } from "@/lib/gestion/threads";

export const metadata: Metadata = {
  title: "Morada Gestion",
  robots: { index: false, follow: false },
};

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { locale, d } = await getI18n();

  // The management space is never public. Signing in happens with the Morada
  // account: same project, same auth.users, no second identity.
  // See src/lib/demo/index.ts: the same development harness, which stands in
  // for a session so every screen can be walked in its empty state.
  let identity =
    previewEmpty()
      ? {
          userId: "preview",
          email: "test@example.invalid",
          displayName: "Compte de test",
          workspaces: [],
          active: { id: "preview", name: "Espace de test", kind: "manager", role: "owner" },
        }
      : await getIdentity();
  // Signing in returns to the page that was asked for (the middleware names it).
  if (!identity) redirect(signInAddress((await headers()).get(REQUESTED_PATH_HEADER), "app"));

  // One account, two roles. Whether this account is a tenant anywhere is the
  // predicate the tenant space starts from (`gestion.is_tenant()`), asked
  // once per request and answered yes or no.
  const session = previewEmpty() ? null : await getSession();
  // Yes, no, or unknown (the question could not be asked): an unknown is not a "no".
  const tenantKnown = session ? await tenantAnswer(session.accessToken) : false;
  const tenant = tenantKnown === true;

  // A first-time account gets its management space silently and lands in the
  // dashboard like everyone else: one continuous product, no onboarding
  // screens between signing in and the existing Gestion page.
  if (!identity.active) {
    const email = identity.email;
    // "No space" is only acted on when it is a fact. When the memberships,
    // or whether this account is a tenant, could not be read, nothing is
    // created and nobody is sent elsewhere: the person is told, and retries.
    if (identity.membershipUnread || tenantKnown === null) {
      return <ProvisionError d={d} email={email} title={d.access.spaceUnreadTitle} body={d.access.spaceUnreadBody} />;
    }
    // ...unless the account was created to accept a tenant invitation: it is
    // a tenant, not (yet) a manager, and is not given a workspace it never
    // asked for. Its own space is the tenant one; a management space is
    // opened on purpose, from there (POST /api/espace/creer), when wanted.
    if (tenant) redirect("/locataire");
    // An account that had a space and has none left was removed from it: it
    // is told so, and opens a space of its own only if it asks to.
    if (hadWorkspace(session?.metadata)) {
      return (
        <NoWorkspace
          email={email}
          labels={{ title: d.access.noSpaceTitle, body: d.access.noSpaceBody, create: d.access.noSpaceCreate, failed: d.auth.provisionFailedBody, signOut: d.shell.signOut }}
        />
      );
    }
    // No space to open is not always "no space yet". An account that is a member of a space the
    // database refuses it (its role does not open the properties) must not be handed the shell
    // under that space's name: every action in it would be refused. It is told so instead.
    if (session) {
      const { data: memberships, error } = await authedClient(session.accessToken).from("crm_members").select("agency_id").eq("user_id", session.userId).eq("status", "active").limit(1);
      if (error) return <ProvisionError d={d} email={email} title={d.access.spaceUnreadTitle} body={d.access.spaceUnreadBody} />;
      if ((memberships ?? []).length > 0) return <ProvisionError d={d} email={email} refused />;
    }
    identity = await provisionDefaultWorkspace();
    if (!identity?.active) return <ProvisionError d={d} email={email} />;
  }

  // Noted on the account once, after the response: this account has had a
  // management space. Its absence on a later visit is then a removal, not a
  // first visit, and nothing is created silently a second time.
  if (session && !hadWorkspace(session.metadata)) {
    const previous = (session.metadata?.morada_account as Record<string, unknown> | undefined) ?? {};
    const token = session.accessToken;
    after(async () => {
      const saved = await updateSignupUser(token, { data: { morada_account: { ...previous, [WORKSPACE_SEEN]: new Date().toISOString() } } }).catch(() => ({ error: { code: "unreachable" } }));
      if (saved.error) console.error("[workspace] could not note the first space on the account:", saved.error.code);
    });
  }

  // An account whose sign-up is not finished continues it: the space opens
  // once the account, the questions and the offer are behind it.
  if (session?.user && resumeStep(session.user) !== "existing") redirect("/inscription");

  // Who may enter (src/lib/billing/access.ts): a running subscription, and
  // nobody else. A locked workspace sees one screen in place of the whole
  // space, on every page; nothing of it is deleted. Off without a Stripe
  // key, for a workspace that never pays, and on a sample cabinet.
  const datasetId = await getDatasetId();
  const workspace = identity.active;
  const gate = datasetId === "real" && session ? await accessFor(workspace, session) : null;
  if (gate?.access === "locked") {
    const offer = offerSchema.safeParse((session?.metadata?.morada_mobile as { offer?: unknown } | undefined)?.offer);
    return (
      <>
        {session && <SessionKeeper />}
        <Locked
          reason={gate.reason ?? "no_trial"}
          email={identity.email}
          canManage={canManageBilling(workspace.role)}
          offer={offer.success ? offer.data : null}
          trialDays={TRIAL_DAYS}
          copy={d.billing.lock}
          errGeneric={d.billing.errGeneric}
          signOut={d.shell.signOut}
        />
      </>
    );
  }

  // The shell's own read: the portfolio, the people and the badges, no
  // history. The screen inside reads what it shows.
  // The trial's counter is read on the account's own data only, alongside
  // the portfolio, and never holds the page (five seconds at most).
  const [demo, billingSnapshot] = await Promise.all([
    getDemo({ shell: true }),
    gate?.configured && session
      ? gate.snapshot ? Promise.resolve(gate.snapshot) : visitSnapshot({ org: workspace, userId: identity.userId, email: session.email || identity.email, locale })
      : Promise.resolve(null),
  ]);

  // Everything the client shell needs, serialized. Identity comes from the
  // session; the dataset only ever supplies figures.
  // On sample data the header names the sample cabinet, not the real agency:
  // the two must never be mistaken for each other on the same screen.
  const sampleCabinet = datasetId === "real" ? null : demo.ORG.shortName;
  // The Messages badge, and its signature: what waits to be read and when the last message was written.
  const unreadMessages = demo.CONVERSATIONS.reduce((a, c) => a + c.unread, 0);
  const lastMessageAt = latestMoment(demo.CONVERSATIONS.filter((c) => c.messages.length > 0).map((c) => c.lastMessageAt));

  // The quick "Bail" sheet joins a lot that can be let to a recorded tenant: nothing else is offered.
  const quickLease = quickLeaseOptions(demo);

  const shellData = {
    datasetId,
    sampleCabinet,
    signedIn: true,
    // The tenant space is offered only to an account that is a tenant
    // somewhere (or on a sample cabinet, where the sample tenant stands in).
    tenant: tenant || sampleCabinet !== null,
    // The dataset seam carries the kind for demo and real alike: on "real",
    // ORG is built from the signed-in workspace.
    workspaceKind: demo.ORG.kind,
    orgShortName: sampleCabinet ?? identity.active.name,
    // A read that failed is said (the shell's banner), so an empty list never passes for an empty
    // workspace. Loyers and Accueil also say the partial failures of their own reads.
    degraded: (demo.DEGRADED?.length ?? 0) > 0,
    userName: identity.displayName,
    userEmail: identity.email,
    badges: {
      review: demo.BANK_TXS.filter((t) => t.status === "review").length,
      unread: unreadMessages,
    },
    unitOptions: demo.UNITS.map((u) => ({
      id: u.id,
      label: `${u.label} \u00b7 ${demo.propertyById(u.propertyId).name}`,
    })),
    // Where a payment is recorded: the tenancies in force, and those that
    // ended still owing (a former tenant pays late). Never a dossier in
    // preparation: it has no ledger for the money to land on.
    leaseOptions: paymentLeases(demo).map((l) => ({
      id: l.id,
      label: `${demo.leaseUnitLabel(l)} \u00b7 ${demo.leaseTenantNames(l).join(", ")}`,
    })),
    vacantUnitOptions: quickLease.units,
    tenantOptions: quickLease.tenants,
    // The getting-started card ticks what the rows attest, never what a
    // browser remembers: the same records Biens, Contacts and Loyers read.
    progress: {
      property: demo.PROPERTIES.length > 0,
      contact: demo.CONTACTS.length > 0,
      lease: demo.LEASES.some((l) => l.status === "active" || l.status === "notice"),
      bank: demo.BANK_ACCOUNTS.length > 0,
      rent: demo.RENT_PERIODS.some((rp) => rp.allocatedCents > 0),
    },
    billing: billingSnapshot ? shellBillingOf(billingSnapshot, workspace.role, billedRents(demo.UNITS, demo.LEASES)) : null,
    // The workspaces the account may open, for the switch in the rail: shown only when there are several, never on a sample cabinet.
    workspaceId: workspace.id,
    workspaces: sampleCabinet === null && identity.workspaces.length > 1 ? identity.workspaces.map((w) => ({ id: w.id, name: w.name })) : [],
  };

  return (
    <>
      {session && <SessionKeeper />}
      <GestionShell locale={locale} dict={d} shell={shellData}>
        {/* Every form of the space reads what a refusal means from here (src/lib/api-errors.ts). */}
        <ApiErrorsProvider copy={d.apiErrors}>{children}</ApiErrorsProvider>
      </GestionShell>
      {/* The badge stays current without a reload: a light read now and then, the page read again when it differs. */}
      {datasetId === "real" && session && <UnreadWatch endpoint="/api/conversations" signature={unreadSignature(unreadMessages, lastMessageAt)} fastOn="/app/messages" />}
    </>
  );
}
