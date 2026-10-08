import type { Metadata } from "next";
import { redirect } from "next/navigation";
import GestionShell from "@/components/gestion/Shell";
import ProvisionError from "@/components/gestion/ProvisionError";
import { getI18n } from "@/lib/i18n";
import { getDatasetId, getDemo } from "@/lib/demo";
import { getIdentity, provisionDefaultWorkspace } from "@/lib/workspace";
import { isTenant } from "@/lib/portal/tenant-space";
import { authedClient, getSession } from "@/lib/supabase/server";
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
    process.env.MORADA_PREVIEW_EMPTY === "1"
      ? {
          userId: "preview",
          email: "test@example.invalid",
          displayName: "Compte de test",
          workspaces: [],
          active: { id: "preview", name: "Espace de test", kind: "manager", role: "owner" },
        }
      : await getIdentity();
  if (!identity) redirect("/connexion?next=/app");

  // One account, two roles. Whether this account is a tenant anywhere is the
  // predicate the tenant space starts from (`gestion.is_tenant()`), asked
  // once per request and answered yes or no.
  const session = process.env.MORADA_PREVIEW_EMPTY === "1" ? null : await getSession();
  const tenant = session ? await isTenant(authedClient(session.accessToken).schema("gestion")) : false;

  // A first-time account gets its management space silently and lands in the
  // dashboard like everyone else: one continuous product, no onboarding
  // screens between signing in and the existing Gestion page.
  if (!identity.active) {
    // ...unless the account was created to accept a tenant invitation: it is
    // a tenant, not (yet) a manager, and is not given a workspace it never
    // asked for. Its own space is the tenant one; a management space is
    // opened on purpose, from there (POST /api/espace/creer), when wanted.
    if (tenant) redirect("/locataire");
    const email = identity.email;
    identity = await provisionDefaultWorkspace();
    if (!identity?.active) return <ProvisionError d={d} email={email} />;
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
    <GestionShell locale={locale} dict={d} shell={shellData}>
      {children}
    </GestionShell>
  );
}
