import { notFound } from "next/navigation";
import InvestmentPreview from "@/components/gestion/investment/InvestmentPreview";
import "@/components/gestion/investment/investment.css";
import { getDemo } from "@/lib/demo";
import { getI18n } from "@/lib/i18n";
import { financePropertiesOf } from "@/lib/investment/portfolio";

/** Development preview until saved-record scope is confirmed. */
export default async function LoansPage() {
  if (process.env.NODE_ENV !== "development") notFound();
  const {locale} = await getI18n();
  return <InvestmentPreview section="loans" locale={locale} properties={financePropertiesOf(await getDemo())}/>;
}
