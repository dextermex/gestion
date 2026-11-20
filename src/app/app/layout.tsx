import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { after } from "next/server";
import GestionShell from "@/components/gestion/Shell";
import SessionKeeper from "@/components/gestion/SessionKeeper";
import ProvisionError from "@/components/gestion/ProvisionError";
import NoWorkspace from "@/components/gestion/NoWorkspace";
import { getI18n } from "@/lib/i18n";
import { getDatasetId, getDemo } from "@/lib/demo";
import { previewEmpty } from "@/lib/deployment";
import { WORKSPACE_SEEN, getIdentity, hadWorkspace, provisionDefaultWorkspace, tenantAnswer } from "@/lib/workspace";
import { getSession } from "@/lib/supabase/server";
import { updateSignupUser } from "@/lib/signup/update-user";
import { REQUESTED_PATH_HEADER, signInAddress } from "@/lib/auth/return-path";
import { billedRents, portfolioLots } from "@/domain/billing/pricing";
import { shellBillingOf, visitSnapshot } from "@/lib/billing/view";

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

  // The shell's own read: the portfolio, the people and the badges, no
  // history. The screen inside reads what it shows.
  // The subscription is the account's own business: read on its own data only,
  // alongside the portfolio, and never holding the page (five seconds at most).
  const datasetId = await getDatasetId();
  const workspace = identity.active;
  const [demo, billingSnapshot] = await Promise.all([
    getDemo({ shell: true }),
    datasetId === "real" && session
      ? visitSnapshot({ org: workspace, userId: identity.userId, email: session.email || identity.email, locale, metadata: session.metadata })
      : Promise.resolve(null),
  ]);

  // Everything the client shell needs, serialized. Identity comes from the
  // session; the dataset only ever supplies figures.
  // On sample data the header names the sample cabinet, not the real agency:
  // the two must never be mistaken for each other on the same screen.
  const sampleCabinet = datasetId === "real" ? null : demo.ORG.shortName;

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
    // A person who belongs to several spaces chooses the one on screen (never on a sample cabinet).
    workspaces: sampleCabinet === null && identity.workspaces.length > 1 ? identity.workspaces.map((w) => ({ id: w.id, name: w.name, active: w.id === workspace.id })) : [],
    userName: identity.displayName,
    userEmail: identity.email,
    badges: {
      review: demo.BANK_TXS.filter((t) => t.status === "review").length,
      unread: demo.CONVERSATIONS.reduce((a, c) => a + c.unread, 0),
    },
    unitOptions: demo.UNITS.map((u) => ({
      id: u.id,
      label: `${u.label} \u00b7 ${demo.propertyById(u.propertyId).name}`,
    })),
    leaseOptions: demo.LEASES.filter((l) => l.status !== "ended").map((l) => ({
      id: l.id,
      label: `${demo.leaseUnitLabel(l)} \u00b7 ${demo.leaseTenantNames(l).join(", ")}`,
    })),
    contactOptions: demo.CONTACTS.map((c) => ({ id: c.id, label: c.name })),
    // The getting-started card ticks what the rows attest, never what a
    // browser remembers: the same records Biens, Contacts and Loyers read.
    progress: {
      property: demo.PROPERTIES.length > 0,
      contact: demo.CONTACTS.length > 0,
      lease: demo.LEASES.some((l) => l.status === "active" || l.status === "notice"),
      bank: demo.BANK_ACCOUNTS.length > 0,
      rent: demo.RENT_PERIODS.some((rp) => rp.allocatedCents > 0),
    },
    billing: billingSnapshot
      ? shellBillingOf(billingSnapshot, workspace.role, {
          lots: portfolioLots(demo.UNITS),
          leases: demo.LEASES.filter((l) => l.status === "active" || l.status === "notice").length,
          rents: billedRents(demo.UNITS, demo.LEASES),
        })
      : null,
  };

  return (
    <>
      {session && <SessionKeeper />}
      <GestionShell locale={locale} dict={d} shell={shellData}>
        {children}
      </GestionShell>
    </>
  );
}
