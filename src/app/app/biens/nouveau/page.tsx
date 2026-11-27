import PropertyWizard from "@/components/gestion/PropertyWizard";
import { getDatasetId } from "@/lib/demo";
import { getI18n } from "@/lib/i18n";
import { propertyTypeParam } from "@/lib/gestion/setup";

/**
 * The property form. `?type=apartment|house|building` preselects the kind
 * (the sign-up's question 10 names it); `?tour=1` is the guided first entry
 * straight after sign-up: finishing or leaving the form returns to Accueil,
 * where the tour plays.
 */
export default async function NouveauBienPage({ searchParams }: { searchParams: Promise<{ type?: string; tour?: string }> }) {
  const [{ d }, datasetId, { type, tour }] = await Promise.all([getI18n(), getDatasetId(), searchParams]);
  const real = datasetId === "real";
  return (
    <PropertyWizard
      d={d}
      real={real}
      notice={d.common.demoCreateNotice}
      noticeTone="demo"
      initialType={propertyTypeParam(type)}
      returnTo={tour === "1" ? "/app?tour=1" : null}
    />
  );
}
