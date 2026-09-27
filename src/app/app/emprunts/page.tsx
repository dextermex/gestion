import InvestmentWorkspace from "@/components/gestion/investment/InvestmentWorkspace";
import "@/components/gestion/investment/investment.css";
import { getDemo, getDatasetId } from "@/lib/demo";
import { getI18n } from "@/lib/i18n";
import { financePropertiesOf } from "@/lib/investment/portfolio";

/** Development preview until saved-record scope is confirmed. */
export default async function LoansPage() {
  const {locale} = await getI18n();
  const datasetId=await getDatasetId(); const demo=await getDemo();
  return <InvestmentWorkspace section="loans" locale={locale} datasetId={datasetId} properties={financePropertiesOf(demo)}/>;
}
