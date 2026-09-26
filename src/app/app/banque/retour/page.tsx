import BankReturnRelay from "@/components/gestion/BankReturnRelay";
import { getDatasetId } from "@/lib/demo";
import { getI18n } from "@/lib/i18n";

/**
 * Where Salt Edge sends the visitor back after the consent journey: one
 * clean address per deployment (its domain listed on the app in the Salt
 * Edge dashboard), which routes to the bank screen's return. A real account
 * lands on the import; a sample cabinet on the demonstration's reading. In
 * the popup the journey opened in, the relay hands that address to the
 * opener and closes. Reads the dataset cookie, so never statically generated.
 */
export const dynamic = "force-dynamic";

export default async function BanqueRetourPage() {
  const [{ d }, dataset] = await Promise.all([getI18n(), getDatasetId()]);
  const target = dataset === "real" ? "/app/banque?connexion=retour" : "/app/banque?connexion=demo";
  return <BankReturnRelay target={target} label={d.banque.connectReturning} />;
}
