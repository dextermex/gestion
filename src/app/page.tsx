import { redirect } from "next/navigation";
import { getSession } from "@/lib/supabase/server";

/** app.morada.lu itself: the space when signed in, the sign-in door otherwise. New accounts start at /inscription. */
export default async function Home() {
  redirect((await getSession()) ? "/app" : "/connexion");
}
