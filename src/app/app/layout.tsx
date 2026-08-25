import type { Metadata } from "next";
import GestionShell from "@/components/gestion/Shell";
import { getI18n } from "@/lib/i18n";
import { getDatasetId, getDemo } from "@/lib/demo";
import { buildSearchIndex } from "@/lib/demo/search";

export const metadata: Metadata = {
  title: "Morada Gestion",
  robots: { index: false, follow: false },
};

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { locale, d } = await getI18n();
  const [demo, datasetId] = await Promise.all([getDemo(), getDatasetId()]);

  // Everything the client shell needs from the active dataset, serialized —
  // badges, search corpus, quick-add options, org identity. The datasets
  // themselves stay server-side.
  const shellData = {
    datasetId,
    orgShortName: demo.ORG.shortName,
    userName: demo.ORG.managerName,
    userEmail: demo.ORG.managerEmail,
    badges: {
      review: demo.BANK_TXS.filter((t) => t.status === "review").length,
      unread: demo.CONVERSATIONS.reduce((a, c) => a + c.unread, 0),
    },
    searchIndex: buildSearchIndex(demo),
    unitOptions: demo.UNITS.map((u) => ({
      id: u.id,
      label: `${u.label} · ${demo.propertyById(u.propertyId).name}`,
    })),
  };

  return (
    <GestionShell locale={locale} dict={d} shell={shellData}>
      {children}
    </GestionShell>
  );
}
