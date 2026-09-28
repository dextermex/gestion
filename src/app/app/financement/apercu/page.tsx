import { notFound } from "next/navigation";
import InvestmentPreview from "@/components/gestion/investment/InvestmentPreview";
import "@/components/gestion/investment/investment.css";
import { financePropertiesOf } from "@/lib/investment/portfolio";
import { getDemo } from "@/lib/demo";
import { getI18n } from "@/lib/i18n";

export default async function InvestmentPreviewPage() {
  if (process.env.NODE_ENV !== "development") notFound();
  const {locale} = await getI18n();
  const demo = await getDemo();
  return <InvestmentPreview locale={locale} properties={financePropertiesOf(demo)}/>;
}
