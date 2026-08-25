import PropertyWizard from "@/components/gestion/PropertyWizard";
import { getI18n } from "@/lib/i18n";

export default async function NouveauBienPage() {
  const { d } = await getI18n();
  return <PropertyWizard d={d} />;
}
