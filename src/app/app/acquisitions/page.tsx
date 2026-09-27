import { notFound } from "next/navigation";
import InvestmentPreview from "@/components/gestion/investment/InvestmentPreview";
import "@/components/gestion/investment/investment.css";
import { getI18n } from "@/lib/i18n";

/** Development preview until saved-record scope is confirmed. */
export default async function AcquisitionsPage() {
  if (process.env.NODE_ENV !== "development") notFound();
  const {locale} = await getI18n();
  return <InvestmentPreview section="acquisitions" locale={locale} properties={[]}/>;
}
