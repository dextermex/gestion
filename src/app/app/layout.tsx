import type { Metadata } from "next";
import { redirect } from "next/navigation";
import GestionShell from "@/components/gestion/Shell";
import SpaceOnboarding from "@/components/gestion/SpaceOnboarding";
import { getI18n } from "@/lib/i18n";
import { getDatasetId, getDemo } from "@/lib/demo";
import { buildSearchIndex } from "@/lib/demo/search";
import { getIdentity } from "@/lib/workspace";

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
  const identity =
    process.env.MORADA_PREVIEW_EMPTY === "1"
      ? {
          userId: "preview",
          email: "test@example.invalid",
          displayName: "Compte de test",
          workspaces: [],
          active:
            process.env.MORADA_PREVIEW_NO_WORKSPACE === "1"
              ? null
              : { id: "preview", name: "Espace de test", kind: "manager", role: "owner" },
        }
      : await getIdentity();
  if (!identity) redirect("/connexion?next=/app");

  // A Morada account that belongs to no management space yet gets the two
  // real ways in (create its own space, or follow an invitation), never a
  // dead end and never a sample workspace.
  if (!identity.active) {
    return <SpaceOnboarding d={d} name={identity.displayName} email={identity.email} />;
  }

  const [demo, datasetId] = await Promise.all([getDemo(), getDatasetId()]);

  // Everything the client shell needs, serialized. Identity comes from the
  // session; the dataset only ever supplies figures.
  // On sample data the header names the sample cabinet, not the real agency:
  // the two must never be mistaken for each other on the same screen.
  const sampleCabinet = datasetId === "real" ? null : demo.ORG.shortName;

  const shellData = {
    datasetId,
    sampleCabinet,
    signedIn: true,
    orgShortName: sampleCabinet ?? identity.active.name,
    userName: identity.displayName,
    userEmail: identity.email,
    badges: {
      review: demo.BANK_TXS.filter((t) => t.status === "review").length,
      unread: demo.CONVERSATIONS.reduce((a, c) => a + c.unread, 0),
    },
    searchIndex: buildSearchIndex(demo),
    unitOptions: demo.UNITS.map((u) => ({
      id: u.id,
      label: `${u.label} \u2014 ${demo.propertyById(u.propertyId).name}`,
    })),
  };

  return (
    <GestionShell locale={locale} dict={d} shell={shellData}>
      {children}
    </GestionShell>
  );
}
