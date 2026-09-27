import PurchaseSimulator from "@/components/gestion/investment/PurchaseSimulator";
import "@/components/gestion/investment/investment.css";
import { getI18n } from "@/lib/i18n";

export default async function PurchaseSimulatorPage() {
  const {locale} = await getI18n();
  return <PurchaseSimulator locale={locale}/>;
}
