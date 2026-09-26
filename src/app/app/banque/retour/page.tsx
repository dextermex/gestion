import { redirect } from "next/navigation";
import { getDatasetId } from "@/lib/demo";

/**
 * Where Salt Edge sends the visitor back after the consent journey: one
 * clean address per deployment (listed on the app in the Salt Edge
 * dashboard), which routes to the bank screen's return. A real account
 * lands on the import; a sample cabinet on the demonstration's reading.
 * Reads the dataset cookie, so it is never statically generated.
 */
export const dynamic = "force-dynamic";

export default async function BanqueRetourPage() {
  const dataset = await getDatasetId();
  redirect(dataset === "real" ? "/app/banque?connexion=retour" : "/app/banque?connexion=demo");
}
