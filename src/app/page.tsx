import { redirect } from "next/navigation";
import { getSession } from "@/lib/supabase/server";
import { phoneSignupEntryEnabled } from "@/lib/signup/rollout";

/** Open the new entry only once SMS, CAPTCHA and a live signup are proven. */
export default async function Home() {
  redirect((await getSession()) ? "/app" : phoneSignupEntryEnabled() ? "/inscription" : "/connexion");
}
