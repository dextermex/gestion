import PropertyWizard from "@/components/gestion/PropertyWizard";
import { getDatasetId } from "@/lib/demo";
import { getI18n } from "@/lib/i18n";

export default async function NouveauBienPage() {
  const [{ d }, datasetId] = await Promise.all([getI18n(), getDatasetId()]);
  const real = datasetId === "real";
  return (
    <PropertyWizard
      d={d}
      real={real}
      notice={d.common.demoCreateNotice}
      noticeTone="demo"
    />
  );
}
