import { redirect } from "next/navigation";
import { getSession } from "@/lib/supabase/server";

/**
 * app.morada.lu: signed in, straight to the space; signed out, the single
 * welcome-and-sign-in page. Nothing in between.
 */
export default async function Home() {
  redirect((await getSession()) ? "/app" : "/connexion");
}
