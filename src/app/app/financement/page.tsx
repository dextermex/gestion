import { redirect } from "next/navigation";

/** The financing section has one room today: its simulator. The section's own address leads there. */
export default function FinancementPage() {
  redirect("/app/financement/simulateur");
}
